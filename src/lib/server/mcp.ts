import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { describeProviderError } from './context';
import { listAddressesForUser } from './domains';
import {
	expandToThreads,
	getEmailForUser,
	listMailbox,
	listThreadMessages,
	markThreadRead,
	setEmailFlags,
	bumpMailboxEpoch
} from './mail-store';
import { resolveReplyFromAddress, sendAndStore } from './outbox';
import { buildReferences, displaySubject } from './threads';
import type { EmailProvider } from './email-provider';
import type { OAuthScope } from './oauth';
import { rememberSenders, listLabels, setThreadLabels } from './labels';
import { isInboxCategory, INBOX_CATEGORIES } from '$lib/mail/categories';
import type { MailboxView, ThreadMessage, User } from '$lib/types';

/**
 * The hosted MCP server: the same tools the CLI's stdio server exposes, but
 * served from the Worker over Streamable HTTP so Claude, Cursor, ChatGPT and
 * friends connect with OAuth instead of a pasted API key.
 *
 * Stateless by design: one `McpServer` per request, no session ids. Every
 * request carries its own bearer token, so nothing needs to survive between
 * isolates.
 */

export const MCP_SERVER_INFO = { name: 'quickinbox', version: '1.2.0' } as const;

export type McpContext = {
	db: D1Database;
	bucket: R2Bucket | undefined;
	provider: () => EmailProvider;
	user: User;
	scopes: readonly string[];
	/** Where the request landed — used to build absolute links in results. */
	origin: string;
};

const views = ['inbox', 'archive', 'starred', 'drafts', 'sent', 'trash', 'spam'] as const;
const categories = INBOX_CATEGORIES;
const MAX_BODY_CHARS = 20_000;

type ToolResult = {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
};

function textResult(value: unknown, isError = false): ToolResult {
	return {
		content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
		...(isError ? { isError: true } : {})
	};
}

function fail(error: unknown): ToolResult {
	return textResult(describeProviderError(error, 'Request failed'), true);
}

/** Trim huge bodies so a newsletter cannot blow the model's context. */
function compactMessage(message: ThreadMessage, origin: string) {
	const text = message.body_text ?? '';
	return {
		id: message.id,
		direction: message.direction,
		from: message.from_name ? `${message.from_name} <${message.from_addr}>` : message.from_addr,
		to: message.to_addr,
		cc: message.cc_addr,
		subject: message.subject,
		date: message.created_at,
		is_read: message.is_read,
		is_starred: message.is_starred,
		status: message.status,
		body_text: text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n…[truncated]` : text,
		has_html: Boolean(message.body_html),
		attachments: message.attachments.map((attachment) => ({
			id: attachment.id,
			filename: attachment.filename,
			content_type: attachment.content_type,
			size_bytes: attachment.size_bytes,
			download_url: `${origin}/api/mail/${message.id}/attachments/${attachment.id}`
		}))
	};
}

async function loadThread(ctx: McpContext, id: string) {
	const email = await getEmailForUser(ctx.db, ctx.user.id, id);
	if (!email) return null;
	const messages = await listThreadMessages(ctx.db, ctx.user.id, email);
	return {
		email,
		threadId: email.thread_id ?? email.id,
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		messages
	};
}

export function hasScope(scopes: readonly string[], scope: OAuthScope): boolean {
	return scopes.includes(scope);
}

/** Build a server whose tool set matches what the token was granted. */
export function createMcpServer(ctx: McpContext): McpServer {
	const server = new McpServer(MCP_SERVER_INFO, {
		instructions:
			`Mail tools for ${ctx.user.name} <${ctx.user.email}> on ${new URL(ctx.origin).host}. ` +
			'Ids returned by list_threads/search_mail can be passed to get_thread, reply, update_thread and list_attachments.'
	});
	const canRead = hasScope(ctx.scopes, 'mail:read');
	const canSend = hasScope(ctx.scopes, 'mail:send');

	server.registerTool(
		'whoami',
		{
			description: 'Who the connected mailbox belongs to, the granted scopes, and the sending addresses available.',
			inputSchema: {}
		},
		async () => {
			try {
				const addresses = await listAddressesForUser(ctx.db, ctx.user.id);
				return textResult({
					user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
					scopes: ctx.scopes,
					addresses: addresses.map((address) => ({
						id: address.id,
						address: address.address,
						label: address.label,
						is_default: address.is_default
					}))
				});
			} catch (error) {
				return fail(error);
			}
		}
	);

	if (canRead) {
		server.registerTool(
			'list_threads',
			{
				description:
					'List mailbox conversations, newest first. Each row is a whole thread; use its latest_id or thread_id with get_thread.',
				inputSchema: {
					view: z.enum(views).optional().describe('Mailbox to list. Defaults to inbox.'),
					category: z
						.enum(categories)
						.optional()
						.describe('Inbox tab when view is inbox. Omit to list every tab.'),
					q: z.string().optional().describe('Search participants, subject, and body.'),
					page: z.number().int().positive().optional(),
					unread: z.boolean().optional().describe('Only conversations with unread messages.'),
					starred: z.boolean().optional(),
					address: z.string().optional().describe('Address id (see whoami) to narrow to one mailbox.')
				}
			},
			async ({ view, category, q, page, unread, starred, address }) => {
				try {
					const mailbox = await listMailbox(ctx.db, ctx.user.id, {
						view: (view ?? 'inbox') as MailboxView,
						category: category ?? null,
						q,
						page,
						unreadOnly: unread,
						starredOnly: starred,
						addressId: address
					});
					return textResult(mailbox);
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'search_mail',
			{
				description: 'Search conversations by participants, subject, or body text.',
				inputSchema: {
					q: z.string().describe('Search text.'),
					view: z.enum(views).optional().describe('Mailbox to search. Defaults to inbox.'),
					category: z.enum(categories).optional().describe('Inbox tab when view is inbox.'),
					page: z.number().int().positive().optional()
				}
			},
			async ({ q, view, category, page }) => {
				try {
					return textResult(
						await listMailbox(ctx.db, ctx.user.id, {
							view: (view ?? 'inbox') as MailboxView,
							category: category ?? null,
							q,
							page
						})
					);
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'get_thread',
			{
				description:
					'Read every message in a conversation. Pass a thread id or any message id from it. Marks the thread read.',
				inputSchema: {
					id: z.string().describe('Thread id or message id.'),
					markRead: z.boolean().optional().describe('Set false to leave unread state untouched.')
				}
			},
			async ({ id, markRead }) => {
				try {
					const thread = await loadThread(ctx, id);
					if (!thread) return textResult(`No message or thread with id ${id}`, true);
					if (markRead !== false) await markThreadRead(ctx.db, ctx.user.id, thread.email);
					return textResult({
						threadId: thread.threadId,
						subject: thread.subject,
						messages: thread.messages.map((message) => compactMessage(message, ctx.origin))
					});
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'list_attachments',
			{
				description: 'List attachments on every message in a thread, with download URLs.',
				inputSchema: { id: z.string().describe('Thread id or message id.') }
			},
			async ({ id }) => {
				try {
					const thread = await loadThread(ctx, id);
					if (!thread) return textResult(`No message or thread with id ${id}`, true);
					const attachments = thread.messages.flatMap((message) =>
						message.attachments.map((attachment) => ({
							...attachment,
							email_id: message.id,
							from: message.from_addr,
							subject: message.subject,
							download_url: `${ctx.origin}/api/mail/${message.id}/attachments/${attachment.id}`
						}))
					);
					return textResult({ threadId: thread.threadId, attachments });
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'list_labels',
			{
				description: 'List custom labels (not inbox category tabs).',
				inputSchema: {}
			},
			async () => {
				try {
					return textResult({ labels: await listLabels(ctx.db, ctx.user.id) });
				} catch (error) {
					return fail(error);
				}
			}
		);
	}

	if (canSend) {
		server.registerTool(
			'send_message',
			{
				description: 'Send a new email from the connected mailbox.',
				inputSchema: {
					to: z.string().describe('Comma-separated recipients.'),
					subject: z.string(),
					text: z.string().optional().describe('Plain-text body. Required unless html is given.'),
					html: z.string().optional(),
					cc: z.string().optional(),
					bcc: z.string().optional(),
					fromAddressId: z.string().optional().describe('Address id (see whoami). Defaults to the default address.')
				}
			},
			async (input) => {
				if (!input.text?.trim() && !input.html?.trim()) return textResult('text or html is required', true);
				if (!ctx.bucket) return textResult('Sending is not configured on this server', true);
				try {
					const { emailId, from } = await sendAndStore(
						{ DB: ctx.db, ATTACHMENTS: ctx.bucket },
						ctx.provider(),
						ctx.user,
						input
					);
					return textResult({ ok: true, id: emailId, from: from.address });
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'reply',
			{
				description:
					'Reply to a message. Recipients, subject and threading headers come from the original; pass `to` to override recipients.',
				inputSchema: {
					id: z.string().describe('Message id to reply to.'),
					text: z.string().optional(),
					html: z.string().optional(),
					to: z.string().optional(),
					cc: z.string().optional(),
					fromAddressId: z.string().optional()
				}
			},
			async ({ id, text, html, to, cc, fromAddressId }) => {
				if (!text?.trim() && !html?.trim()) return textResult('text or html is required', true);
				if (!ctx.bucket) return textResult('Sending is not configured on this server', true);
				try {
					const original = await getEmailForUser(ctx.db, ctx.user.id, id);
					if (!original) return textResult(`No message with id ${id}`, true);
					const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
					const recipient =
						to?.trim() || (original.direction === 'inbound' ? original.from_addr : original.to_addr);
					const fromAddress = fromAddressId
						? undefined
						: await resolveReplyFromAddress(ctx.db, ctx.user, original);
					const { emailId, from } = await sendAndStore(
						{ DB: ctx.db, ATTACHMENTS: ctx.bucket },
						ctx.provider(),
						ctx.user,
						{
							fromAddressId,
							fromAddress,
							to: recipient,
							cc: cc?.trim() || undefined,
							subject,
							text,
							html,
							inReplyTo: original.message_id,
							references: buildReferences(original.references_header, original.message_id),
							replyToEmailId: original.id
						}
					);
					return textResult({ ok: true, id: emailId, from: from.address, to: recipient, subject });
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'update_thread',
			{
				description: 'Mark a conversation read/unread, star it, archive it, move it to spam, or set its inbox tab.',
				inputSchema: {
					id: z.string().describe('Thread id or message id.'),
					isRead: z.boolean().optional(),
					isStarred: z.boolean().optional(),
					archived: z.boolean().optional(),
					trashed: z.boolean().optional(),
					spam: z.boolean().optional(),
					category: z.enum(categories).optional()
				}
			},
			async ({ id, isRead, isStarred, archived, trashed, spam, category }) => {
				if (!canRead) return textResult('This operation needs mail:read and mail:send.', true);
				if (
					[isRead, isStarred, archived, trashed, spam, category].every((value) => value === undefined)
				) {
					return textResult(
						'Pass at least one of isRead, isStarred, archived, trashed, spam, category',
						true
					);
				}
				try {
					const ids = await expandToThreads(ctx.db, ctx.user.id, [id]);
					const changed = await setEmailFlags(ctx.db, ctx.user.id, ids, {
						isRead,
						isStarred,
						archived,
						trashed,
						spam,
						spamSource: spam === undefined ? undefined : 'user',
						category: isInboxCategory(category) ? category : undefined,
						categorySource: category !== undefined ? 'user' : undefined
					});
					if (changed === 0) return textResult(`No message or thread with id ${id}`, true);
					if (spam === true) await rememberSenders(ctx.db, ctx.user.id, ids, 'spam');
					if (spam === false) await rememberSenders(ctx.db, ctx.user.id, ids, 'safe');
					return textResult({ ok: true, messages_changed: changed });
				} catch (error) {
					return fail(error);
				}
			}
		);

		server.registerTool(
			'set_thread_labels',
			{
				description: 'Replace the custom labels on a conversation. Pass an empty list to clear them.',
				inputSchema: {
					id: z.string().describe('Thread id or message id.'),
					labelIds: z.array(z.string()).describe('Label ids from list_labels.')
				}
			},
			async ({ id, labelIds }) => {
				if (!canRead) return textResult('This operation needs mail:read and mail:send.', true);
				try {
					const ids = await expandToThreads(ctx.db, ctx.user.id, [id]);
					if (ids.length === 0) return textResult(`No message or thread with id ${id}`, true);
					await setThreadLabels(ctx.db, ctx.user.id, ids, labelIds);
					await bumpMailboxEpoch(ctx.db, ctx.user.id);
					return textResult({ ok: true, messages_changed: ids.length });
				} catch (error) {
					return fail(error);
				}
			}
		);
	}

	return server;
}

/** Serve one Streamable HTTP request. JSON responses only — nothing here streams. */
export async function handleMcpRequest(request: Request, ctx: McpContext): Promise<Response> {
	const server = createMcpServer(ctx);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	try {
		await server.connect(transport);
		return await transport.handleRequest(request);
	} finally {
		// Stateless: nothing outlives the response.
		void transport.close().catch(() => {});
	}
}
