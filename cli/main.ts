import { writeFile } from 'node:fs/promises';
import { stdin as stdinStream } from 'node:process';
import {
	QuickInboxClient,
	QuickInboxError,
	safeDownloadName,
	type MailboxView,
	type ThreadSummary
} from './client.ts';
import { clearConfig, envFlag, loadConfig, saveConfig } from './config.ts';

const HELP = `quickinbox — operate a Quickinbox instance from the terminal

Usage:
  quickinbox login --url <https://mail.example.com> --token <qi_live_…>
  quickinbox logout
  quickinbox whoami

Mail:
  quickinbox inbox [--page N] [--unread] [--domain ID]
  quickinbox search <query> [--view inbox|sent|drafts|starred|trash]
  quickinbox read <thread-or-message-id>
  quickinbox send --to <addr> --subject <text> [--body <text>] [--from <address-id>]
  quickinbox reply <id> [--body <text>]
  quickinbox attachments <id>
  quickinbox download <email-id> <attachment-id> [--out file]

Admin:
  quickinbox users list
  quickinbox users create --name <name> --local <part> --domain <id> --password <pw>
  quickinbox users delete <id>
  quickinbox users passwd <id-or-email> --password <pw>
  quickinbox domains list
  quickinbox domains connect <id>
  quickinbox domains disconnect <id>
  quickinbox addresses list [--all]
  quickinbox addresses create --local <part> --domain <id> [--user <id>]
  quickinbox unrouted

MCP:
  quickinbox mcp

Auth is a Settings → API keys bearer token. QUICKINBOX_URL and QUICKINBOX_TOKEN
override the saved config (`QUICKMAIL_URL` / `QUICKMAIL_TOKEN` still work).
The `quickmail` command is an alias for `quickinbox`. Use --json on mail/admin
commands for raw output.
`;

type Flags = Record<string, string | boolean>;

function parseArgv(argv: string[]): { command: string[]; flags: Flags } {
	const command: string[] = [];
	const flags: Flags = {};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--') {
			command.push(...argv.slice(i + 1));
			break;
		}
		if (arg.startsWith('--')) {
			const [rawKey, inline] = arg.slice(2).split('=', 2);
			const key = alias(rawKey);
			if (inline !== undefined) {
				flags[key] = inline;
			} else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
				flags[key] = argv[i + 1];
				i += 1;
			} else {
				flags[key] = true;
			}
			continue;
		}
		if (arg.startsWith('-') && arg.length === 2) {
			const key = alias(arg.slice(1));
			if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
				flags[key] = argv[i + 1];
				i += 1;
			} else {
				flags[key] = true;
			}
			continue;
		}
		command.push(arg);
	}

	return { command, flags };
}

function alias(key: string): string {
	switch (key) {
		case 't':
			return 'to';
		case 's':
			return 'subject';
		case 'b':
			return 'body';
		case 'q':
			return 'query';
		case 'h':
			return 'help';
		case 'u':
			return 'url';
		default:
			return key;
	}
}

function flagString(flags: Flags, key: string): string | undefined {
	const value = flags[key];
	return typeof value === 'string' ? value : undefined;
}

function flagBool(flags: Flags, key: string): boolean {
	return flags[key] === true || flags[key] === '1' || flags[key] === 'true';
}

async function readBody(flags: Flags): Promise<string> {
	const inline = flagString(flags, 'body');
	if (inline) return inline;
	if (!stdinStream.isTTY) {
		const chunks: Buffer[] = [];
		for await (const chunk of stdinStream) chunks.push(Buffer.from(chunk));
		return Buffer.concat(chunks).toString('utf8').trim();
	}
	return '';
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function terminalSafe(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

function printThreads(page: { threads: ThreadSummary[]; total: number; page: number; pageCount: number }): void {
	if (page.threads.length === 0) {
		console.log('No conversations.');
		return;
	}

	for (const thread of page.threads) {
		const who = thread.participants
			.map((participant) =>
				participant.self ? 'me' : terminalSafe(participant.label || participant.address)
			)
			.join(', ');
		const unread = thread.is_read ? ' ' : '*';
		console.log(`${unread} ${thread.thread_id}  ${who}`);
		console.log(`  ${thread.subject || '(no subject)'}  — ${thread.preview}`);
	}
	console.log(`\n${page.total} conversation${page.total === 1 ? '' : 's'}  page ${page.page}/${page.pageCount}`);
}

async function clientFromConfig(): Promise<QuickInboxClient> {
	const config = await loadConfig();
	return new QuickInboxClient(config.url, config.token);
}

async function resolveUserId(client: QuickInboxClient, idOrEmail: string): Promise<string> {
	if (!idOrEmail.includes('@')) return idOrEmail;
	const { users } = await client.listUsers();
	const user = users.find((entry) => entry.email.toLowerCase() === idOrEmail.toLowerCase());
	if (!user) throw new Error(`No user with email ${idOrEmail}`);
	return user.id;
}

function mailboxView(value: string | undefined): MailboxView {
	switch (value) {
		case 'inbox':
		case 'starred':
		case 'drafts':
		case 'sent':
		case 'trash':
			return value;
		case undefined:
			return 'inbox';
		default:
			throw new Error('view must be inbox, sent, drafts, starred, or trash');
	}
}

async function run(argv: string[]): Promise<number> {
	const { command, flags } = parseArgv(argv);
	if (flagBool(flags, 'help') || command[0] === 'help' || command.length === 0) {
		console.log(HELP);
		return 0;
	}

	const json = flagBool(flags, 'json');
	const [head, sub, ...rest] = command;

	switch (head) {
		case 'login': {
			const url = flagString(flags, 'url');
			const token = flagString(flags, 'token') ?? envFlag('QUICKINBOX_TOKEN', 'QUICKMAIL_TOKEN');
			if (!url) {
				throw new Error('login requires --url');
			}
			if (!token) {
				throw new Error(
					'login requires --token or QUICKINBOX_TOKEN (create a key in Settings → API keys)'
				);
			}
			const client = new QuickInboxClient(url, token);
			const user = await client.whoami();
			const path = await saveConfig({ url, token });
			console.log(`Logged in as ${user.email} (${path})`);
			return 0;
		}
		case 'logout':
			await clearConfig();
			console.log('Logged out.');
			return 0;
		case 'whoami': {
			const user = await (await clientFromConfig()).whoami();
			if (json) printJson(user);
			else console.log(`${user.name} <${user.email}>${user.is_admin ? '  admin' : ''}`);
			return 0;
		}
		case 'inbox':
		case 'list': {
			const client = await clientFromConfig();
			const page = await client.listThreads({
				view: 'inbox',
				page: Number(flagString(flags, 'page')) || 1,
				unread: flagBool(flags, 'unread'),
				domain: flagString(flags, 'domain')
			});
			if (json) printJson(page);
			else printThreads(page);
			return 0;
		}
		case 'search': {
			const q = rest[0] ?? sub ?? flagString(flags, 'query');
			if (!q) throw new Error('search requires a query');
			const client = await clientFromConfig();
			const page = await client.listThreads({
				q,
				view: mailboxView(flagString(flags, 'view')),
				page: Number(flagString(flags, 'page')) || 1
			});
			if (json) printJson(page);
			else printThreads(page);
			return 0;
		}
		case 'read':
		case 'thread': {
			const id = sub;
			if (!id) throw new Error('read requires a thread or message id');
			const client = await clientFromConfig();
			const thread = await client.getThread(id);
			if (json) {
				printJson(thread);
				return 0;
			}
			console.log(thread.subject);
			for (const message of thread.messages) {
				const from = terminalSafe(message.from_name || message.from_addr);
				const to = terminalSafe(message.to_addr);
				console.log(
					`\n--- ${from} → ${to}  ${message.created_at}`
				);
				console.log(message.body_text?.trim() || '(no text body)');
				if (message.attachments.length > 0) {
					console.log(
						message.attachments
							.map((attachment) => `  attachment ${attachment.id}  ${attachment.filename}`)
							.join('\n')
					);
				}
			}
			return 0;
		}
		case 'send': {
			const to = flagString(flags, 'to');
			const subject = flagString(flags, 'subject');
			const text = await readBody(flags);
			if (!to || !subject || !text) {
				throw new Error('send requires --to, --subject, and --body (or stdin)');
			}
			const result = await (
				await clientFromConfig()
			).sendMessage({
				to,
				subject,
				text,
				cc: flagString(flags, 'cc'),
				bcc: flagString(flags, 'bcc'),
				fromAddressId: flagString(flags, 'from')
			});
			if (json) printJson(result);
			else console.log(`Sent ${result.id}`);
			return 0;
		}
		case 'reply': {
			const id = sub;
			const text = await readBody(flags);
			if (!id || !text) throw new Error('reply requires an id and --body (or stdin)');
			const result = await (await clientFromConfig()).reply(id, { text });
			if (json) printJson(result);
			else console.log(`Sent ${result.id}`);
			return 0;
		}
		case 'attachments': {
			const id = sub;
			if (!id) throw new Error('attachments requires a thread or message id');
			const thread = await (await clientFromConfig()).getThread(id);
			const rows = thread.messages.flatMap((message) =>
				message.attachments.map((attachment) => ({
					email_id: message.id,
					...attachment
				}))
			);
			if (json) printJson(rows);
			else if (rows.length === 0) console.log('No attachments.');
			else {
				for (const row of rows) {
					console.log(`${row.email_id}  ${row.id}  ${row.filename}  ${row.size_bytes}B`);
				}
			}
			return 0;
		}
		case 'download': {
			const emailId = sub;
			const attachmentId = rest[0];
			if (!emailId || !attachmentId) throw new Error('download requires <email-id> <attachment-id>');
			const file = await (await clientFromConfig()).downloadAttachment(emailId, attachmentId);
			const out = flagString(flags, 'out') ?? safeDownloadName(file.filename);
			await writeFile(out, file.bytes);
			console.log(out);
			return 0;
		}
		case 'users':
			return usersCommand(sub, rest, flags, json);
		case 'domains':
			return domainsCommand(sub, rest, flags, json);
		case 'addresses':
			return addressesCommand(sub, rest, flags, json);
		case 'unrouted': {
			const items = await (await clientFromConfig()).listUnrouted(Number(flagString(flags, 'limit')) || 50);
			if (json) printJson(items);
			else if (items.length === 0) console.log('No unrouted mail.');
			else {
				for (const item of items) {
					console.log(`${item.created_at}  ${item.from_addr} → ${item.to_addr}`);
					console.log(`  ${item.subject ?? '(no subject)'}  — ${item.reason}`);
				}
			}
			return 0;
		}
		case 'mcp': {
			// Lazy-load MCP so mail commands never import @modelcontextprotocol/sdk.
			let startMcpServer: typeof import('./mcp.ts').startMcpServer;
			try {
				({ startMcpServer } = await import('./mcp.ts'));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (
					message.includes('Cannot find') &&
					(message.includes('mcp') || message.includes('@modelcontextprotocol/sdk'))
				) {
					throw new Error(
						'MCP is not installed. Re-run: curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickinbox/main/scripts/install.sh | sh'
					);
				}
				throw error;
			}
			await startMcpServer();
			return 0;
		}
		default:
			throw new Error(`Unknown command "${head}". Run quickinbox --help.`);
	}
}

async function usersCommand(sub: string | undefined, rest: string[], flags: Flags, json: boolean): Promise<number> {
	const client = await clientFromConfig();

	switch (sub) {
		case 'list': {
			const data = await client.listUsers();
			if (json) printJson(data);
			else {
				for (const user of data.users) {
					const addrs = data.addresses
						.filter((address) => address.user_id === user.id)
						.map((address) => address.address)
						.join(', ');
					console.log(`${user.id}  ${user.name}  ${user.email}${user.is_admin ? '  admin' : ''}`);
					if (addrs) console.log(`  ${addrs}`);
				}
			}
			return 0;
		}
		case 'create': {
			const name = flagString(flags, 'name');
			const localPart = flagString(flags, 'local');
			const domainId = flagString(flags, 'domain');
			const password = flagString(flags, 'password');
			if (!name || !localPart || !domainId || !password) {
				throw new Error('users create requires --name, --local, --domain, and --password');
			}
			const created = await client.createUser({ name, localPart, domainId, password });
			if (json) printJson(created);
			else console.log(`Created ${created.user.email} (${created.user.id})`);
			return 0;
		}
		case 'delete': {
			const id = rest[0];
			if (!id) throw new Error('users delete requires a user id');
			await client.deleteUser(id);
			console.log(`Deleted ${id}`);
			return 0;
		}
		case 'passwd':
		case 'password': {
			const idOrEmail = rest[0];
			const password = flagString(flags, 'password');
			if (!idOrEmail || !password) throw new Error('users passwd requires <id-or-email> and --password');
			const id = await resolveUserId(client, idOrEmail);
			await client.resetPassword(id, password);
			console.log(`Password reset for ${idOrEmail}`);
			return 0;
		}
		default:
			throw new Error('users commands: list, create, delete, passwd');
	}
}

async function domainsCommand(sub: string | undefined, rest: string[], flags: Flags, json: boolean): Promise<number> {
	const client = await clientFromConfig();
	void flags;

	switch (sub) {
		case 'list': {
			const data = await client.listDomains();
			if (json) printJson(data);
			else {
				console.log('Connected');
				for (const domain of data.connected) {
					console.log(
						`  ${domain.id}  ${domain.name}  ${domain.status}  send=${domain.sending_enabled} receive=${domain.receiving_enabled}`
					);
				}
				if (data.available.length > 0) {
					console.log('Available');
					for (const domain of data.available) {
						console.log(`  ${domain.id}  ${domain.name}${domain.connected ? '  connected' : ''}`);
					}
				}
			}
			return 0;
		}
		case 'connect': {
			const id = rest[0];
			if (!id) throw new Error('domains connect requires a domain id');
			await client.connectDomain(id);
			console.log(`Connected ${id}`);
			return 0;
		}
		case 'disconnect': {
			const id = rest[0];
			if (!id) throw new Error('domains disconnect requires a domain id');
			await client.disconnectDomain(id);
			console.log(`Disconnected ${id}`);
			return 0;
		}
		default:
			throw new Error('domains commands: list, connect, disconnect');
	}
}

async function addressesCommand(sub: string | undefined, rest: string[], flags: Flags, json: boolean): Promise<number> {
	const client = await clientFromConfig();
	void rest;

	switch (sub) {
		case 'list': {
			const addresses = await client.listAddresses(flagBool(flags, 'all'));
			if (json) printJson(addresses);
			else {
				for (const address of addresses) {
					console.log(
						`${address.id}  ${address.address}${address.is_default ? '  default' : ''}  ${address.user_id}`
					);
				}
			}
			return 0;
		}
		case 'create': {
			const localPart = flagString(flags, 'local');
			const domainId = flagString(flags, 'domain');
			if (!localPart || !domainId) throw new Error('addresses create requires --local and --domain');
			const address = await client.createAddress({
				localPart,
				domainId,
				userId: flagString(flags, 'user')
			});
			if (json) printJson(address);
			else console.log(`Created ${address.address}`);
			return 0;
		}
		default:
			throw new Error('addresses commands: list, create');
	}
}

const code = await run(process.argv.slice(2)).catch((error) => {
	const message = error instanceof QuickInboxError ? `${error.status} ${error.message}` : error.message;
	console.error(message);
	return 1;
});

if (code !== 0) process.exit(code);
