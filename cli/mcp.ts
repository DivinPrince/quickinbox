import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
	findThreadAcross,
	listThreadsAcross,
	QuickInboxClient,
	QuickInboxError,
	type AccountClient,
	type MailboxView
} from './client.ts';
import { loadAccounts } from './config.ts';

const views = ['inbox', 'archive', 'starred', 'drafts', 'sent', 'trash', 'spam'] as const;
const categories = ['primary', 'social', 'promotions', 'updates', 'forums'] as const;

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

/**
 * Accounts are read once at startup (the MCP process is short-lived and restarts
 * with the host). Each tool takes an optional `account`; read-only listings fan
 * out to every account when it is omitted so several inboxes can be worked at once.
 */
class Accounts {
	readonly all: AccountClient[];
	readonly defaultName: string;

	constructor(accounts: { name: string; url: string; token: string }[], defaultName: string) {
		this.all = accounts.map((account) => ({
			name: account.name,
			client: new QuickInboxClient(account.url, account.token)
		}));
		this.defaultName = defaultName;
	}

	get names(): string[] {
		return this.all.map((account) => account.name);
	}

	get default(): AccountClient {
		return this.all.find((account) => account.name === this.defaultName) ?? this.all[0];
	}

	/** A single account: the named one, else the default. */
	one(name?: string): AccountClient {
		if (!name) return this.default;
		const wanted = name.trim().toLowerCase();
		const match = this.all.find((account) => account.name === wanted);
		if (!match) {
			throw new Error(`Unknown account "${name.trim()}". Known accounts: ${this.names.join(', ')}.`);
		}
		return match;
	}

	/** Accounts to fan out to: the named one, or all of them. */
	many(name?: string): AccountClient[] {
		return name ? [this.one(name)] : this.all;
	}

	/** Default first, so id lookups hit the most likely account before the rest. */
	get searchOrder(): AccountClient[] {
		const first = this.default;
		return [first, ...this.all.filter((account) => account !== first)];
	}
}

const accountArg = (accounts: Accounts) =>
	z
		.string()
		.optional()
		.describe(
			accounts.all.length > 1
				? `Account name (see list_accounts). One of: ${accounts.names.join(', ')}. Defaults to "${accounts.defaultName}".`
				: 'Account name (see list_accounts). Only one account is configured, so this can be omitted.'
		);

const accountArgForListing = (accounts: Accounts) =>
	z
		.string()
		.optional()
		.describe(
			accounts.all.length > 1
				? `Account name (see list_accounts). One of: ${accounts.names.join(', ')}. Omit to query every account at once; each result is tagged with its "account".`
				: 'Account name (see list_accounts). Only one account is configured, so this can be omitted.'
		);

const accountArgForIdLookup = (accounts: Accounts) =>
	z
		.string()
		.optional()
		.describe(
			accounts.all.length > 1
				? `Account name (see list_accounts). One of: ${accounts.names.join(', ')}. Omit to look the id up in every account ("${accounts.defaultName}" first).`
				: 'Account name (see list_accounts). Only one account is configured, so this can be omitted.'
		);

const idLookupHint = (accounts: Accounts) =>
	accounts.all.length > 1
		? ' When `account` is omitted, every account is checked for the id (default account first) and the owning account is returned as "account".'
		: '';

export async function startMcpServer(): Promise<void> {
	const loaded = await loadAccounts();
	if (loaded.accounts.length === 0 || !loaded.defaultName) {
		throw new Error(
			'Not logged in. Run `quickinbox login --url <instance> --token <key>` or set QUICKINBOX_URL and QUICKINBOX_TOKEN.'
		);
	}
	const accounts = new Accounts(loaded.accounts, loaded.defaultName);
	const multi = accounts.all.length > 1;

	const server = new McpServer({ name: 'quickinbox', version: '1.1.0' });

	server.registerTool(
		'list_accounts',
		{
			description:
				'List the Quickinbox accounts this server can act as, with the user each token belongs to. ' +
				'Pass an account name as `account` to other tools; the default is used when omitted.',
			inputSchema: {}
		},
		async () => {
			try {
				const rows = await Promise.all(
					accounts.all.map(async ({ name, client }) => {
						try {
							const user = await client.whoami();
							return {
								account: name,
								url: client.url,
								default: name === accounts.defaultName,
								user: { email: user.email, name: user.name, is_admin: user.is_admin }
							};
						} catch (error) {
							return {
								account: name,
								url: client.url,
								default: name === accounts.defaultName,
								error:
									error instanceof QuickInboxError
										? `${error.status} ${error.message}`
										: error instanceof Error
											? error.message
											: 'Request failed'
							};
						}
					})
				);
				return textResult({ default: accounts.defaultName, accounts: rows });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'list_threads',
		{
			description: multi
				? 'List mailbox conversations. Without `account`, lists every configured account at once and tags each thread with its "account"; pass that name back to get_thread, reply, or list_attachments.'
				: 'List mailbox conversations for the authenticated Quickinbox user.',
			inputSchema: {
				view: z.enum(views).optional().describe('Mailbox to list. Defaults to inbox.'),
				category: z.enum(categories).optional().describe('Inbox tab when view is inbox.'),
				q: z.string().optional().describe('Search participants, subject, and body.'),
				page: z.number().int().positive().optional().describe('Page number, applied per account.'),
				unread: z.boolean().optional(),
				domain: z.string().optional().describe('Connected domain id to filter by (within one account).'),
				account: accountArgForListing(accounts)
			}
		},
		async ({ view, category, q, page, unread, domain, account }) => {
			try {
				return textResult(
					await listThreadsAcross(accounts.many(account), {
						view: view as MailboxView | undefined,
						category,
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
			description: `Read every message in a conversation. Pass a thread id or any message id from it.${idLookupHint(accounts)}`,
			inputSchema: {
				id: z.string().describe('Thread id or message id.'),
				account: accountArgForIdLookup(accounts)
			}
		},
		async ({ id, account }) => {
			try {
				const found = await findThreadAcross(account ? [accounts.one(account)] : accounts.searchOrder, id);
				return textResult({ account: found.account.name, ...found.thread });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'search_mail',
		{
			description: multi
				? 'Search mailbox conversations by participants, subject, or body. Without `account`, searches every configured account at once.'
				: 'Search mailbox conversations by participants, subject, or body.',
			inputSchema: {
				q: z.string().describe('Search text.'),
				view: z.enum(views).optional(),
				category: z.enum(categories).optional(),
				page: z.number().int().positive().optional().describe('Page number, applied per account.'),
				account: accountArgForListing(accounts)
			}
		},
		async ({ q, view, category, page, account }) => {
			try {
				return textResult(
					await listThreadsAcross(accounts.many(account), {
						q,
						view: view as MailboxView | undefined,
						category,
						page
					})
				);
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'send_message',
		{
			description: multi
				? `Send a new email. Sends from the "${accounts.defaultName}" account unless \`account\` is given.`
				: 'Send a new email from the authenticated user.',
			inputSchema: {
				to: z.string(),
				subject: z.string(),
				text: z.string().optional(),
				html: z.string().optional(),
				cc: z.string().optional(),
				bcc: z.string().optional(),
				fromAddressId: z.string().optional().describe('Address id within the chosen account.'),
				account: accountArg(accounts)
			}
		},
		async ({ account, ...input }) => {
			try {
				if (!input.text?.trim() && !input.html?.trim()) {
					return textResult('text or html is required', true);
				}
				const target = accounts.one(account);
				const result = await target.client.sendMessage(input);
				return textResult({ account: target.name, ...result });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'reply',
		{
			description: `Reply to a message or thread. Recipients and subject are taken from the original.${idLookupHint(accounts)}`,
			inputSchema: {
				id: z.string().describe('Message id to reply to.'),
				text: z.string().optional(),
				html: z.string().optional(),
				fromAddressId: z.string().optional().describe('Address id within the owning account.'),
				account: accountArgForIdLookup(accounts)
			}
		},
		async ({ id, text, html, fromAddressId, account }) => {
			try {
				if (!text?.trim() && !html?.trim()) {
					return textResult('text or html is required', true);
				}
				let target: AccountClient;
				if (account || accounts.all.length === 1) {
					target = accounts.one(account);
				} else {
					// Replies must go out from the instance that holds the original message.
					target = (await findThreadAcross(accounts.searchOrder, id)).account;
				}
				const result = await target.client.reply(id, { text, html, fromAddressId });
				return textResult({ account: target.name, ...result });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'list_attachments',
		{
			description: `List attachments on every message in a thread.${idLookupHint(accounts)}`,
			inputSchema: {
				id: z.string().describe('Thread id or message id.'),
				account: accountArgForIdLookup(accounts)
			}
		},
		async ({ id, account }) => {
			try {
				const found = await findThreadAcross(account ? [accounts.one(account)] : accounts.searchOrder, id);
				const attachments = found.thread.messages.flatMap((message) =>
					message.attachments.map((attachment) => ({
						...attachment,
						email_id: message.id,
						from: message.from_addr,
						subject: message.subject
					}))
				);
				return textResult({ account: found.account.name, threadId: found.thread.threadId, attachments });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'update_thread',
		{
			description: `Mark a conversation read/unread, star it, archive it, move it to spam, or set its inbox tab.${idLookupHint(accounts)}`,
			inputSchema: {
				id: z.string().describe('Thread id or message id.'),
				isRead: z.boolean().optional(),
				isStarred: z.boolean().optional(),
				archived: z.boolean().optional(),
				trashed: z.boolean().optional(),
				spam: z.boolean().optional(),
				category: z.enum(categories).optional(),
				account: accountArgForIdLookup(accounts)
			}
		},
		async ({ id, account, ...flags }) => {
			if (Object.values(flags).every((value) => value === undefined)) {
				return textResult(
					'Pass at least one of isRead, isStarred, archived, trashed, spam, category',
					true
				);
			}
			try {
				const found = await findThreadAcross(account ? [accounts.one(account)] : accounts.searchOrder, id);
				const result = await found.account.client.updateThread(id, flags);
				return textResult({ account: found.account.name, ...result });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'list_labels',
		{
			description: multi
				? 'List custom labels. Without `account`, lists every configured account.'
				: 'List custom labels (not inbox category tabs).',
			inputSchema: { account: accountArgForListing(accounts) }
		},
		async ({ account }) => {
			try {
				const rows = await Promise.all(
					accounts.many(account).map(async ({ name, client }) => ({
						account: name,
						labels: await client.listLabels()
					}))
				);
				return textResult(account || accounts.all.length === 1 ? rows[0] : { accounts: rows });
			} catch (error) {
				return fail(error);
			}
		}
	);

	server.registerTool(
		'set_thread_labels',
		{
			description: `Replace the custom labels on a conversation. Pass an empty list to clear them.${idLookupHint(accounts)}`,
			inputSchema: {
				id: z.string().describe('Thread id or message id.'),
				labelIds: z.array(z.string()).describe('Label ids from list_labels.'),
				account: accountArgForIdLookup(accounts)
			}
		},
		async ({ id, labelIds, account }) => {
			try {
				const found = await findThreadAcross(account ? [accounts.one(account)] : accounts.searchOrder, id);
				const result = await found.account.client.setThreadLabels(id, labelIds);
				return textResult({ account: found.account.name, ...result });
			} catch (error) {
				return fail(error);
			}
		}
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}
