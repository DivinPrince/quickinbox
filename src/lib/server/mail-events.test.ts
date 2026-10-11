import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DurableObjectState, D1Database } from '@cloudflare/workers-types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { createApiToken, revokeApiToken } from './api-tokens';
import { handleCloudflareInbound } from './cloudflare-inbound';
import { hashToken } from './crypto';
import { handleResendWebhook } from './inbound';
import { MailEvents } from './mail-events-broker';
import type { ResendClient } from './resend';
import {
	createMailEventServer,
	MAIL_EVENT_DEFINITION,
	MAIL_EVENT_NAME,
	SUBSCRIPTION_META_KEY,
	type MailEventSubscriber,
	type NewMailEvent
} from './mail-events';
import { createTestDb, insertTestUser } from './test-db';

const EmptyResultSchema = z.object({}).passthrough();
const testEvent = (id: string, emailId: string, threadId = emailId): NewMailEvent => ({
	eventId: id,
	timestamp: '2026-10-11T12:00:00.000Z',
	data: { emailId, threadId, source: 'resend' }
});

function seedMail(sqlite: ReturnType<typeof createTestDb>['sqlite'], id: string, userId: string, direction = 'inbound') {
	sqlite
		.query(
			`INSERT INTO emails (id, user_id, direction, from_addr, to_addr, subject, thread_id)
			 VALUES (?, ?, ?, 'sender@example.net', 'recipient@example.com', 'Fixture subject', NULL)`
		)
		.run(id, userId, direction);
}

function seedMailbox(sqlite: ReturnType<typeof createTestDb>['sqlite'], userId = 'mail-user') {
	insertTestUser(sqlite, userId);
	sqlite.query(`INSERT INTO domains (id, name) VALUES ('mail-domain', 'example.com')`).run();
	sqlite
		.query(`INSERT INTO addresses (id, user_id, domain_id, address, is_default)
			VALUES ('mail-address', ?, 'mail-domain', 'ada@example.com', 1)`)
		.run(userId);
}

function eventCapture(db: D1Database) {
	const events: Array<{ userId: string; event: NewMailEvent }> = [];
	const attachmentCountsAtPublish: number[] = [];
	let resolvePublish!: () => void;
	const published = new Promise<void>((resolve) => (resolvePublish = resolve));
	const binding = {
		idFromName: (userId: string) => userId,
		get: (userId: string) => ({
			fetch: async (_input: string, init: RequestInit) => {
				const body = JSON.parse(String(init.body)) as { userId: string; event: NewMailEvent };
				events.push(body);
				const row = await db
					.prepare('SELECT COUNT(*) AS count FROM email_attachments WHERE email_id = ?')
					.bind(body.event.data.emailId)
					.first<{ count: number }>();
				attachmentCountsAtPublish.push(Number(row?.count ?? 0));
				resolvePublish();
				return new Response(null, { status: 204 });
			}
		})
	};
	return { binding, events, attachmentCountsAtPublish, published };
}

async function setupUser(db: D1Database, sqlite: ReturnType<typeof createTestDb>['sqlite'], id: string) {
	insertTestUser(sqlite, id);
	return createApiToken(db, id, { name: `read-${id}`, scopes: ['mail:read'] });
}

async function connectEventServer() {
	const subscribers = new Set<MailEventSubscriber>();
	const server = createMailEventServer(subscribers);
	const client = new Client({ name: 'mail-events-test', version: '1.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const notifications: Array<{ method?: string; params?: Record<string, unknown> }> = [];
	let notify!: () => void;
	let notificationArrived = new Promise<void>((resolve) => (notify = resolve));
	const onNotification = (notification: { method?: string; params?: Record<string, unknown> }) => {
		notifications.push(notification as { method?: string; params?: Record<string, unknown> });
		notify();
	};
	for (const method of [
		'notifications/events/active',
		'notifications/events/event',
		'notifications/events/terminated'
	] as const) {
		client.setNotificationHandler(
			NotificationSchema.extend({ method: z.literal(method), params: z.record(z.string(), z.unknown()).optional() }),
			onNotification
		);
	}
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return {
		client,
		server,
		subscribers,
		notifications,
		waitNotification: async (index: number) => {
			while (notifications.length <= index) {
				const arrived = notificationArrived;
				await arrived;
				notificationArrived = new Promise<void>((resolve) => (notify = resolve));
			}
			return notifications[index]!;
		}
	};
}

class MemoryStorage {
	private values = new Map<string, unknown>();
	async get<T>(key: string): Promise<T | undefined> {
		return this.values.get(key) as T | undefined;
	}
	async put(key: string, value: unknown): Promise<void> {
		this.values.set(key, value);
	}
	async transaction<T>(callback: (storage: this) => Promise<T>): Promise<T> {
		return callback(this);
	}
}

function brokerFixture(db: D1Database) {
	const storage = new MemoryStorage();
	const state = { storage } as unknown as DurableObjectState;
	return { broker: new MailEvents(state, { DB: db }), storage };
}

function putBrokerSession(
	broker: MailEvents,
	input: { id: string; userId: string; token: string; subscriber: MailEventSubscriber; closed: () => void }
) {
	const sessions = (broker as unknown as { sessions: Map<string, unknown> }).sessions;
	const subscribers = new Set([input.subscriber]);
	sessions.set(input.id, {
		transport: undefined,
		server: { close: async () => { input.subscriber.stop(); input.closed(); } },
		subscribers,
		userId: input.userId,
		token: input.token,
		touched: Date.now()
	});
}

async function publish(broker: MailEvents, userId: string, event: NewMailEvent): Promise<Response> {
	return broker.fetch(
		new Request('https://mail-events.internal/publish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, event })
		})
	);
}

function brokerRequest(
	broker: MailEvents,
	input: { token: string; sessionId?: string; message: Record<string, unknown>; accept?: string }
) {
	return broker.fetch(
		new Request('https://events.example.test/mcp', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${input.token}`,
				'Content-Type': 'application/json',
				Accept: input.accept ?? 'application/json, text/event-stream',
				...(input.sessionId ? { 'mcp-session-id': input.sessionId } : {})
			},
			body: JSON.stringify(input.message)
		})
	);
}

async function initializeBroker(broker: MailEvents, token: string) {
	const response = await brokerRequest(broker, {
		token,
		message: {
			jsonrpc: '2.0', id: 1, method: 'initialize',
			params: {
				protocolVersion: '2025-03-26',
				capabilities: {},
				clientInfo: { name: 'mail-events-test', version: '1.0.0' }
			}
		}
	});
	assert.equal(response.status, 200);
	const sessionId = response.headers.get('mcp-session-id');
	assert.ok(sessionId, 'initialize returns an MCP session id');
	await brokerRequest(broker, {
		token,
		sessionId,
		message: { jsonrpc: '2.0', method: 'notifications/initialized' }
	});
	return sessionId;
}

function sessionById(broker: MailEvents, id: string) {
	return (broker as unknown as { sessions: Map<string, { subscribers: Set<unknown> }> }).sessions.get(id);
}

describe('QuickInbox MCP mail events', () => {
	test('events/list exposes the single new-mail event and its schemas', async () => {
		const { client, server } = await connectEventServer();
		try {
			const result = await client.request(
				{ method: 'events/list' } as never,
				z.object({ events: z.array(z.record(z.string(), z.unknown())) })
			);
			assert.deepEqual(result.events, [MAIL_EVENT_DEFINITION]);
			assert.equal(result.events[0]?.name, 'email.received');
			assert.deepEqual(result.events[0]?.delivery, ['stream']);
			assert.deepEqual(result.events[0]?.inputSchema, {
				type: 'object', properties: {}, additionalProperties: false
			});
			assert.deepEqual(result.events[0]?.payloadSchema, MAIL_EVENT_DEFINITION.payloadSchema);
		} finally {
			await client.close();
			await server.close();
		}
	});

	test('events/stream signals active, sends body-free mail event with correlated metadata, and cleans up on cancellation', async () => {
		const { client, server, subscribers, waitNotification } = await connectEventServer();
		const abort = new AbortController();
		const response = client.request(
			{ method: 'events/stream', params: { name: MAIL_EVENT_NAME, arguments: {} } } as never,
			EmptyResultSchema,
			{ signal: abort.signal, timeout: 10_000 }
		);
		try {
			const active = await waitNotification(0);
			assert.equal(active.method, 'notifications/events/active');
			const meta = active.params?._meta as Record<string, unknown>;
			assert.ok(meta[SUBSCRIPTION_META_KEY]);
			assert.equal(active.params?.status, 'active');
			assert.equal(subscribers.size, 1);

			const event = testEvent('event-1', 'mail-1', 'thread-1');
			await [...subscribers][0]!.send(event);
			const received = await waitNotification(1);
			assert.equal(received.method, 'notifications/events/event');
			assert.deepEqual(received.params, {
				...event,
				name: MAIL_EVENT_NAME,
				_meta: meta
			});
			assert.equal(JSON.stringify(received.params).includes('Fixture subject'), false);
			assert.equal(JSON.stringify(received.params).includes('sender@example.net'), false);
		} finally {
			abort.abort();
			await response.catch(() => undefined);
			await client.close();
			await server.close();
		}
		assert.equal(subscribers.size, 0);
	});

	test('publisher is a no-op when the Events binding is disabled', async () => {
		const { scheduleMailEvent } = await import('./mail-events');
		let scheduled = false;
		scheduleMailEvent(
			{ DB: {} as D1Database, waitUntil: () => { scheduled = true; } },
			{ userId: 'u1', emailId: 'missing', providerId: 'provider-1', source: 'resend' }
		);
		assert.equal(scheduled, false);
	});

	test('publisher sends normalized identifiers and source through the recipient mailbox binding without mail content', async () => {
		const { db, sqlite } = createTestDb();
		insertTestUser(sqlite, 'u1');
		seedMail(sqlite, 'mail-1', 'u1');
		let routedId: string | undefined;
		let posted: unknown;
		const tasks: Promise<void>[] = [];
		const namespace = {
			idFromName: (id: string) => { routedId = id; return id; },
			get: (id: string) => ({
				fetch: async (_url: string, init: RequestInit) => {
					posted = JSON.parse(String(init.body));
					return new Response(null, { status: 204 });
				}
			})
		};
		const { scheduleMailEvent } = await import('./mail-events');
		scheduleMailEvent(
			{
				DB: db,
				MAIL_EVENTS: namespace as never,
				waitUntil: (task) => { tasks.push(task); }
			},
			{ userId: 'u1', emailId: 'mail-1', providerId: 'provider-1', source: 'cloudflare' }
		);
		await Promise.all(tasks);
		const body = posted as { userId: string; event: NewMailEvent };
		assert.equal(routedId, 'u1');
		assert.equal(body.userId, 'u1');
		assert.equal(body.event.eventId, await hashToken('cloudflare\nprovider-1'));
		assert.equal(body.event.data.emailId, 'mail-1');
		assert.equal(body.event.data.threadId, 'mail-1');
		assert.equal(body.event.data.source, 'cloudflare');
		assert.ok(Number.isFinite(Date.parse(body.event.timestamp)));
		assert.equal(JSON.stringify(body).includes('Fixture subject'), false);
	});

	test('Resend ingress publishes only after the new email and attachment are stored', async () => {
		const { db, sqlite } = createTestDb();
		seedMailbox(sqlite);
		const capture = eventCapture(db);
		const background: Promise<unknown>[] = [];
		const storedObjects: string[] = [];
		const env = {
			DB: db,
			ATTACHMENTS: { put: async (key: string) => { storedObjects.push(key); } },
			MAIL_EVENTS: capture.binding,
			waitUntil: (task: Promise<unknown>) => { background.push(task); }
		} as never;
		const client = {
			async getReceivedEmail(providerId: string) {
				return {
					from: 'Sender <sender@example.net>',
					to: [providerId === 'unrouted-1' ? 'nobody@else.test' : 'ada@example.com'],
					cc: [],
					bcc: [],
					received_for: [providerId === 'unrouted-1' ? 'nobody@else.test' : 'ada@example.com'],
					subject: 'Stored message',
					text: 'private body',
					html: null,
					message_id: `<${providerId}@resend.test>`,
					headers: { from: 'Sender <sender@example.net>' }
				};
			},
			async listReceivedAttachments() {
				return [{ id: 'attachment-1', filename: 'note.txt', content_type: 'text/plain', size: 3, download_url: 'https://resend.test/note' }];
			},
			async downloadAttachment() { return new Uint8Array([1, 2, 3]); }
		} as unknown as ResendClient;

		const first = await handleResendWebhook(
			{ type: 'email.received', data: { email_id: 'provider-1', received_for: ['ada@example.com'] } },
			env,
			client
		);
		assert.equal(first.handled, true);
		await capture.published;
		const stored = await db.prepare('SELECT id, direction, provider_id FROM emails WHERE provider_id = ?').bind('provider-1').first<{ id: string; direction: string; provider_id: string }>();
		assert.ok(stored);
		assert.equal(stored.direction, 'inbound');
		assert.equal(capture.events.length, 1);
		assert.equal(capture.events[0]?.userId, 'mail-user');
		assert.equal(capture.events[0]?.event.data.emailId, stored.id);
		assert.equal(capture.events[0]?.event.data.source, 'resend');
		assert.equal(capture.attachmentCountsAtPublish[0], 1);
		assert.equal(storedObjects.length, 1);
		const attachment = await db.prepare('SELECT filename FROM email_attachments WHERE email_id = ?').bind(stored.id).first<{ filename: string }>();
		assert.equal(attachment?.filename, 'note.txt');

		await handleResendWebhook(
			{ type: 'email.received', data: { email_id: 'provider-1', received_for: ['ada@example.com'] } },
			env,
			client
		);
		await handleResendWebhook(
			{ type: 'email.received', data: { email_id: 'unrouted-1', received_for: ['nobody@else.test'] } },
			env,
			client
		);
		sqlite.query(`INSERT INTO emails (id, user_id, direction, from_addr, to_addr, subject, provider_id)
			VALUES ('sent-1', 'mail-user', 'outbound', 'ada@example.com', 'sender@example.net', 'Sent', 'outbound-provider')`).run();
		await handleResendWebhook(
			{ type: 'email.delivered', data: { email_id: 'outbound-provider' } },
			env,
			client
		);
		assert.equal(capture.events.length, 1, 'duplicate, unrouted, and outbound delivery callbacks do not publish');
		await Promise.allSettled(background);
	});

	test('Cloudflare email ingress publishes after email and attachment storage, and publish failure does not reject receipt', async () => {
		const { db, sqlite } = createTestDb();
		seedMailbox(sqlite);
		const capture = eventCapture(db);
		const background: Promise<unknown>[] = [];
		const storedObjects: string[] = [];
		const env = {
			DB: db,
			ATTACHMENTS: { put: async (key: string) => { storedObjects.push(key); } },
			MAIL_EVENTS: capture.binding,
			waitUntil: (task: Promise<unknown>) => { background.push(task); }
		} as never;
		const raw = [
			'From: Sender <sender@example.net>',
			'To: ada@example.com',
			'Subject: Cloudflare message',
			'Message-ID: <cf-message-1@example.net>',
			'Date: Sun, 11 Oct 2026 12:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="mail-boundary"',
			'',
			'--mail-boundary',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'private cloudflare body',
			'--mail-boundary',
			'Content-Type: text/plain; name="cloud.txt"',
			'Content-Transfer-Encoding: base64',
			'Content-Disposition: attachment; filename="cloud.txt"',
			'',
			'Y2Y=',
			'--mail-boundary--',
			''
		].join('\r\n');
		let rejected: string | undefined;
		await handleCloudflareInbound(
			{
				from: 'sender@example.net',
				to: 'ada@example.com',
				headers: new Headers(),
				raw: new Response(raw).body!,
				setReject: (reason: string) => { rejected = reason; }
			} as never,
			env
		);
		await capture.published;
		assert.equal(rejected, undefined);
		assert.equal(capture.events.length, 1);
		assert.equal(capture.events[0]?.userId, 'mail-user');
		assert.equal(capture.events[0]?.event.data.source, 'cloudflare');
		assert.equal(capture.attachmentCountsAtPublish[0], 1);
		assert.equal(storedObjects.length, 1);
		const emailId = capture.events[0]!.event.data.emailId;
		const attachment = await db.prepare('SELECT filename FROM email_attachments WHERE email_id = ?').bind(emailId).first<{ filename: string }>();
		assert.equal(attachment?.filename, 'cloud.txt');
		await Promise.allSettled(background);

		const failureEnv = {
			DB: db,
			ATTACHMENTS: { put: async () => {} },
			MAIL_EVENTS: {
				idFromName: (id: string) => id,
				get: () => ({ fetch: async () => { throw new Error('broker unavailable'); } })
			}
		} as never;
		const secondRaw = raw.replace('<cf-message-1@example.net>', '<cf-message-2@example.net>').replace('Cloudflare message', 'Second message');
		await assert.doesNotReject(
			handleCloudflareInbound(
				{ from: 'sender@example.net', to: 'ada@example.com', headers: new Headers(), raw: new Response(secondRaw).body!, setReject: () => {} } as never,
				failureEnv
			)
		);
		await Promise.allSettled(background);
	});

	test('broker isolates recipients, suppresses duplicate event ids, and stops sending after token revocation', async () => {
		const { db, sqlite } = createTestDb();
		const token1 = await setupUser(db, sqlite, 'u1');
		insertTestUser(sqlite, 'u2');
		seedMail(sqlite, 'mail-1', 'u1');
		seedMail(sqlite, 'mail-2', 'u2');
		const { broker } = brokerFixture(db);
		const user1Events: NewMailEvent[] = [];
		const user2Events: NewMailEvent[] = [];
		let user1Stopped = false;
		const sub1: MailEventSubscriber = { send: async (event) => { user1Events.push(event); }, stop: () => { user1Stopped = true; } };
		const sub2: MailEventSubscriber = { send: async (event) => { user2Events.push(event); }, stop: () => {} };
		let closed1 = 0;
		putBrokerSession(broker, { id: 's1', userId: 'u1', token: token1.token, subscriber: sub1, closed: () => { closed1++; } });
		const token2 = await createApiToken(db, 'u2', { name: 'u2-read', scopes: ['mail:read'] });
		putBrokerSession(broker, { id: 's2', userId: 'u2', token: token2.token, subscriber: sub2, closed: () => {} });

		const first = testEvent('dedupe-1', 'mail-1');
		assert.equal((await publish(broker, 'u1', first)).status, 204);
		assert.equal((await publish(broker, 'u1', first)).status, 204);
		assert.deepEqual(user1Events, [first]);
		assert.deepEqual(user2Events, []);

		assert.equal(await revokeApiToken(db, 'u1', token1.summary.id), true);
		const second = testEvent('dedupe-2', 'mail-1');
		assert.equal((await publish(broker, 'u1', second)).status, 204);
		assert.equal(user1Stopped, true);
		assert.equal(closed1, 1);
		assert.deepEqual(user1Events, [first]);
		assert.deepEqual(user2Events, []);
	});

	test('broker refuses invalid, outbound, and cross-user mail events before broadcast', async () => {
		const { db, sqlite } = createTestDb();
		const token1 = await setupUser(db, sqlite, 'u1');
		insertTestUser(sqlite, 'u2');
		seedMail(sqlite, 'inbound-1', 'u1');
		seedMail(sqlite, 'outbound-1', 'u1', 'outbound');
		seedMail(sqlite, 'inbound-2', 'u2');
		const { broker } = brokerFixture(db);
		const delivered: NewMailEvent[] = [];
		const sub: MailEventSubscriber = { send: async (event) => { delivered.push(event); }, stop: () => {} };
		putBrokerSession(broker, { id: 's1', userId: 'u1', token: token1.token, subscriber: sub, closed: () => {} });

		assert.equal((await publish(broker, 'u1', testEvent('outbound', 'outbound-1'))).status, 400);
		assert.equal((await publish(broker, 'u1', testEvent('wrong-owner', 'inbound-2'))).status, 400);
		const invalid = await broker.fetch(
			new Request('https://mail-events.internal/publish', {
				method: 'POST', body: JSON.stringify({ userId: 'u1', event: { ...testEvent('invalid', 'inbound-1'), data: { ...testEvent('invalid', 'inbound-1').data, source: 'outbound' } } })
			})
		);
		assert.equal(invalid.status, 400);
		assert.deepEqual(delivered, []);
	});

	test('broker expires a live subscription when its read token no longer authenticates', async () => {
		const { db, sqlite } = createTestDb();
		const token = await setupUser(db, sqlite, 'u1');
		seedMail(sqlite, 'mail-1', 'u1');
		const { broker } = brokerFixture(db);
		let closed = 0;
		const sub: MailEventSubscriber = { send: async () => { assert.fail('revoked session received an event'); }, stop: () => {} };
		putBrokerSession(broker, { id: 's1', userId: 'u1', token: token.token, subscriber: sub, closed: () => { closed++; } });
		await revokeApiToken(db, 'u1', token.summary.id);
		assert.equal((await publish(broker, 'u1', testEvent('revoked', 'mail-1'))).status, 204);
		assert.equal(closed, 1);
	});

	test('HTTP broker requires read scope, isolates session tokens, rejects bad stream requests, and forgets restarted sessions', async () => {
		const { db, sqlite } = createTestDb();
		const user1 = await setupUser(db, sqlite, 'http-u1');
		const user1Again = await createApiToken(db, 'http-u1', { name: 'second-read-key', scopes: ['mail:read'] });
		insertTestUser(sqlite, 'http-u2');
		const user2 = await createApiToken(db, 'http-u2', { name: 'other-read-key', scopes: ['mail:read'] });
		const sendOnly = await createApiToken(db, 'http-u1', { name: 'send-only' });
		const state = { storage: new MemoryStorage() } as unknown as DurableObjectState;
		const broker = new MailEvents(state, { DB: db });
		const noRead = await brokerRequest(broker, {
			token: sendOnly.token,
			message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }
		});
		assert.equal(noRead.status, 401);

		const sessionId = await initializeBroker(broker, user1.token);
		const listed = await brokerRequest(broker, {
			token: user1.token,
			sessionId,
			message: { jsonrpc: '2.0', id: 2, method: 'events/list' }
		});
		assert.equal(listed.status, 200);
		assert.match(await listed.text(), /email\.received/);
		assert.equal((await brokerRequest(broker, {
			token: user1Again.token,
			sessionId,
			message: { jsonrpc: '2.0', id: 3, method: 'events/list' }
		})).status, 404, 'another token for the same user cannot adopt this session');
		assert.equal((await brokerRequest(broker, {
			token: user2.token,
			sessionId,
			message: { jsonrpc: '2.0', id: 4, method: 'events/list' }
		})).status, 404, 'another user cannot adopt this session');

		for (const [id, params] of [
			[5, { name: 'email.sent', arguments: {} }],
			[6, { name: MAIL_EVENT_NAME, arguments: { unexpected: true } }]
		] as const) {
			const rejected = await brokerRequest(broker, {
				token: user1.token,
				sessionId,
				message: { jsonrpc: '2.0', id, method: 'events/stream', params }
			});
			assert.equal(rejected.status, 200);
			const body = await rejected.text();
			assert.match(body, /error/);
			assert.doesNotMatch(body, /notifications\/events\/active/);
			assert.equal(sessionById(broker, sessionId)?.subscribers.size, 0);
		}

		const restarted = new MailEvents(state, { DB: db });
		assert.equal((await brokerRequest(restarted, {
			token: user1.token,
			sessionId,
			message: { jsonrpc: '2.0', id: 7, method: 'events/list' }
		})).status, 404, 'the in-memory MCP session is lost when the DO instance restarts');
	});

	test('HTTP stream starts after initialize and cancellation notification removes its subscriber', async () => {
		const { db, sqlite } = createTestDb();
		const token = await setupUser(db, sqlite, 'http-stream-user');
		const { broker } = brokerFixture(db);
		const sessionId = await initializeBroker(broker, token.token);
		const stream = await brokerRequest(broker, {
			token: token.token,
			sessionId,
			message: {
				jsonrpc: '2.0', id: 22, method: 'events/stream',
				params: { name: MAIL_EVENT_NAME, arguments: {} }
			}
		});
		assert.equal(stream.status, 200);
		assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
		const activeChunk = await stream.body!.getReader().read();
		assert.equal(activeChunk.done, false);
		assert.match(new TextDecoder().decode(activeChunk.value), /notifications\/events\/active/);
		assert.equal(sessionById(broker, sessionId)?.subscribers.size, 1);

		await brokerRequest(broker, {
			token: token.token,
			sessionId,
			message: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 22, reason: 'test cancellation' } }
		});
		const session = sessionById(broker, sessionId)!;
		assert.equal(session.subscribers.size, 0);
		await broker.fetch(new Request('https://events.example.test/mcp', { method: 'DELETE', headers: { Authorization: `Bearer ${token.token}`, 'mcp-session-id': sessionId } }));
	});

	test('cancelling the HTTP response body clears its MCP session', async () => {
		const { db, sqlite } = createTestDb();
		const token = await setupUser(db, sqlite, 'http-body-user');
		const { broker } = brokerFixture(db);
		const sessionId = await initializeBroker(broker, token.token);
		const response = await brokerRequest(broker, {
			token: token.token,
			sessionId,
			message: {
				jsonrpc: '2.0', id: 23, method: 'events/stream',
				params: { name: MAIL_EVENT_NAME, arguments: {} }
			}
		});
		const reader = response.body!.getReader();
		const first = await reader.read();
		assert.match(new TextDecoder().decode(first.value), /notifications\/events\/active/);
		assert.ok(sessionById(broker, sessionId));
		await reader.cancel('consumer disconnected');
		assert.equal(sessionById(broker, sessionId), undefined);
	});
});
