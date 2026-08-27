import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { QuickInboxClient, QuickInboxError, type MailboxView } from './client.ts';
import { loadConfig } from './config.ts';

const views = ['inbox', 'starred', 'drafts', 'sent', 'trash'] as const;

function textResult(value: unknown, isError = false) {
	return {
		content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
		isError
	};
}

function fail(error: unknown) {
	if (error instanceof QuickInboxError) {
		return textResult(`${error.status} ${error.message}`, true);
	}
	return textResult(error instanceof Error ? error.message : 'Request failed', true);
}

export async function startMcpServer(): Promise<void> {
	const config = await loadConfig();
	const client = new QuickInboxClient(config.url, config.token);

	const server = new McpServer({ name: 'quickinbox', version: '1.0.0' });

	server.registerTool(
		'list_threads',
		{
			description: 'List mailbox conversations for the authenticated Quickinbox user.',
			inputSchema: {
				view: z.enum(views).optional().describe('Mailbox to list. Defaults to inbox.'),
				q: z.string().optional().describe('Search participants, subject, and body.'),
				page: z.number().int().positive().optional(),
				unread: z.boolean().optional(),
				domain: z.string().optional().describe('Connected domain id to filter by.')
			}
		},
		async ({ view, q, page, unread, domain }) => {
			try {
				return textResult(
					await client.listThreads({
						view: view as MailboxView | undefined,
						q,
						page,
						unread,
						domain
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
			description: 'Read every message in a conversation. Pass a thread id or any message id from it.',
			inputSchema: { id: z.string().describe('Thread id or message id.') }
		},
		async ({ id }) => {
			try {
				return textResult(await client.getThread(id));
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'search_mail',
		{
			description: 'Search mailbox conversations by participants, subject, or body.',
			inputSchema: {
				q: z.string().describe('Search text.'),
				view: z.enum(views).optional(),
				page: z.number().int().positive().optional()
			}
		},
		async ({ q, view, page }) => {
			try {
				return textResult(await client.listThreads({ q, view: view as MailboxView | undefined, page }));
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'send_message',
		{
			description: 'Send a new email from the authenticated user.',
			inputSchema: {
				to: z.string(),
				subject: z.string(),
				text: z.string().optional(),
				html: z.string().optional(),
				cc: z.string().optional(),
				bcc: z.string().optional(),
				fromAddressId: z.string().optional()
			}
		},
		async (input) => {
			try {
				if (!input.text?.trim() && !input.html?.trim()) {
					return textResult('text or html is required', true);
				}
				return textResult(await client.sendMessage(input));
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'reply',
		{
			description: 'Reply to a message or thread. Recipients and subject are taken from the original.',
			inputSchema: {
				id: z.string().describe('Message id to reply to.'),
				text: z.string().optional(),
				html: z.string().optional(),
				fromAddressId: z.string().optional()
			}
		},
		async ({ id, text, html, fromAddressId }) => {
			try {
				if (!text?.trim() && !html?.trim()) {
					return textResult('text or html is required', true);
				}
				return textResult(await client.reply(id, { text, html, fromAddressId }));
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'list_attachments',
		{
			description: 'List attachments on every message in a thread.',
			inputSchema: { id: z.string().describe('Thread id or message id.') }
		},
		async ({ id }) => {
			try {
				const thread = await client.getThread(id);
				const attachments = thread.messages.flatMap((message) =>
					message.attachments.map((attachment) => ({
						...attachment,
						email_id: message.id,
						from: message.from_addr,
						subject: message.subject
					}))
				);
				return textResult({ threadId: thread.threadId, attachments });
			} catch (error) {
				return fail(error);
			}
		}
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}
