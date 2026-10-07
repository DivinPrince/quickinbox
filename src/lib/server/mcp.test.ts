import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { User } from '$lib/types';
import type { EmailProvider } from './email-provider';
import { createMcpServer } from './mcp';
import type { OutboundMailInput } from './send-mail';
import { createTestDb, insertTestUser } from './test-db';

const user: User = {
	id: 'user-1',
	email: 'ada@example.com',
	name: 'Ada',
	is_admin: false,
	must_change_password: false,
	created_at: '2026-01-01T00:00:00.000Z'
};

async function connect(options: { sendEnabled?: boolean; scopes?: string[] } = {}) {
	const { db, sqlite } = createTestDb();
	insertTestUser(sqlite, user.id);
	sqlite.query(`INSERT INTO domains (id, name) VALUES ('dom-1', 'example.com')`).run();
	sqlite
		.query(
			`INSERT INTO addresses (id, user_id, domain_id, address, is_default)
			 VALUES ('addr-1', ?, 'dom-1', 'ada@example.com', 1)`
		)
		.run(user.id);
	const insert = sqlite.query(
		`INSERT INTO emails (id, user_id, direction, from_addr, to_addr, subject, thread_id, created_at)
		 VALUES (?, ?, 'inbound', 'sam@other.test', 'ada@example.com', 'Plans', 'm1', ?)`
	);
	insert.run('m1', user.id, '2026-09-01 10:00:00');

	const sent: OutboundMailInput[] = [];
	const provider = {
		kind: 'cloudflare',
		async send(input: OutboundMailInput) {
			sent.push(input);
			return { providerId: `provider-${sent.length}` };
		}
	} as unknown as EmailProvider;

	const server = createMcpServer({
		db,
		bucket: {} as R2Bucket,
		provider: () => provider,
		user,
		scopes: options.scopes ?? ['mail:read', 'mail:send'],
		origin: 'https://mail.example.com',
		sendPolicy: { enabled: options.sendEnabled ?? true, dailyLimit: 100 }
	});
	const client = new Client({ name: 'test', version: '1.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	const call = async (name: string, args: Record<string, unknown>) => {
		const result = (await client.callTool({ name, arguments: args })) as {
			content: { text: string }[];
			isError?: boolean;
		};
		const text = result.content[0]?.text ?? '';
		return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
	};
	const addInbound = (id: string, at: string) => insert.run(id, user.id, at);
	/** A reply sent from the web app, outside this MCP session. */
	const addOutbound = (id: string, at: string) =>
		sqlite
			.query(
				`INSERT INTO emails (id, user_id, direction, from_addr, to_addr, subject, thread_id, created_at)
				 VALUES (?, ?, 'outbound', 'ada@example.com', 'sam@other.test', 'Re: Plans', 'm1', ?)`
			)
			.run(id, user.id, at);
	return { client, call, sent, addInbound, addOutbound };
}

describe('hosted MCP tools', () => {
	test('marks read tools read-only and send tools as irreversible', async () => {
		const { client } = await connect();
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((tool) => [tool.name, tool.annotations ?? {}]));

		for (const name of ['whoami', 'list_threads', 'search_mail', 'list_attachments', 'list_labels']) {
			assert.equal(byName.get(name)?.readOnlyHint, true, name);
		}
		for (const name of ['send_message', 'reply']) {
			assert.equal(byName.get(name)?.destructiveHint, true, name);
		}
	});

	test('reply has no way to add recipients beyond the reviewed target', async () => {
		const { client } = await connect();
		const reply = (await client.listTools()).tools.find((tool) => tool.name === 'reply');
		const fields = Object.keys(reply?.inputSchema.properties ?? {});

		assert.ok(fields.includes('expected_recipients'));
		for (const field of ['to', 'cc', 'bcc']) assert.ok(!fields.includes(field), field);
	});

	test('the instance switch removes the send tools but keeps triage', async () => {
		const { client } = await connect({ sendEnabled: false });
		const names = (await client.listTools()).tools.map((tool) => tool.name);

		assert.ok(!names.includes('send_message'));
		assert.ok(!names.includes('reply'));
		assert.ok(names.includes('update_thread'));
	});

	test('get_thread tells the agent where a reply would go', async () => {
		const { call } = await connect();
		const thread = (await call('get_thread', { id: 'm1' })).json();

		assert.deepEqual(thread.messages[0].reply_target, ['sam@other.test']);
	});

	test('reply sends to the reviewed target once, however often it is retried', async () => {
		const { call, sent } = await connect();
		const args = {
			id: 'm1',
			expected_recipients: ['sam@other.test'],
			text: 'Thursday works.',
			idempotency_key: 'reply-key-0001'
		};

		const first = await call('reply', args);
		const retry = await call('reply', args);

		assert.equal(first.isError, false, first.text);
		assert.equal(retry.json().id, first.json().id);
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].to, ['sam@other.test']);
	});

	test('reply refuses once a newer message arrived', async () => {
		const { call, sent, addInbound } = await connect();
		addInbound('m2', '2026-09-01 12:00:00');

		const result = await call('reply', {
			id: 'm1',
			expected_recipients: ['sam@other.test'],
			text: 'Thursday works.',
			idempotency_key: 'reply-key-0002'
		});

		assert.equal(result.isError, true);
		assert.equal(result.json().error.code, 'conversation_advanced');
		assert.equal(sent.length, 0);
	});

	test('reply refuses once the person already answered from the web app', async () => {
		const { call, sent, addOutbound } = await connect();
		addOutbound('m2', '2026-09-01 11:00:00');

		const result = await call('reply', {
			id: 'm1',
			expected_recipients: ['sam@other.test'],
			text: 'Thursday works.',
			idempotency_key: 'reply-key-0004'
		});

		assert.equal(result.json().error.code, 'conversation_advanced');
		assert.equal(sent.length, 0);
	});

	test('reply refuses recipients the agent was not shown', async () => {
		const { call, sent } = await connect();

		const result = await call('reply', {
			id: 'm1',
			expected_recipients: ['attacker@evil.test'],
			text: 'Here are the files.',
			idempotency_key: 'reply-key-0003'
		});

		assert.equal(result.json().error.code, 'recipient_changed');
		assert.equal(sent.length, 0);
	});
});
