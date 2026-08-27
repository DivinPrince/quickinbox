import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import webpush from 'web-push';
import {
	MAX_SUBSCRIPTIONS_PER_USER,
	buildNewMailPayload,
	parsePushSubscription,
	pushErrorStatus,
	readVapidConfiguration,
	savePushSubscription,
	scheduleNewMailNotification
} from './push-notifications';

const vapidKeys = webpush.generateVAPIDKeys();

const validSubscription = {
	endpoint: 'https://push.example.com/subscriptions/device-1',
	expirationTime: null,
	keys: {
		p256dh: vapidKeys.publicKey,
		auth: 'AAAAAAAAAAAAAAAAAAAAAA'
	}
};

describe('push subscription parsing', () => {
	test('accepts browser subscription JSON', () => {
		assert.deepEqual(parsePushSubscription(validSubscription), validSubscription);
	});

	test('rejects insecure endpoints and malformed keys', () => {
		assert.equal(
			parsePushSubscription({ ...validSubscription, endpoint: 'http://push.example.com/device' }),
			null
		);
		assert.equal(
			parsePushSubscription({
				...validSubscription,
				keys: { ...validSubscription.keys, auth: 'not base64!' }
			}),
			null
		);
		assert.equal(parsePushSubscription({ endpoint: validSubscription.endpoint }), null);
		assert.equal(
			parsePushSubscription({
				...validSubscription,
				keys: { ...validSubscription.keys, p256dh: validSubscription.keys.p256dh.slice(1) }
			}),
			null
		);
	});
});

describe('VAPID configuration', () => {
	test('requires all keys and a contact URI', () => {
		assert.deepEqual(
			readVapidConfiguration({
				VAPID_PUBLIC_KEY: vapidKeys.publicKey,
				VAPID_PRIVATE_KEY: vapidKeys.privateKey,
				VAPID_SUBJECT: 'mailto:admin@example.com'
			}),
			{ ...vapidKeys, subject: 'mailto:admin@example.com' }
		);
		assert.equal(
			readVapidConfiguration({
				VAPID_PUBLIC_KEY: vapidKeys.publicKey,
				VAPID_PRIVATE_KEY: vapidKeys.privateKey,
				VAPID_SUBJECT: 'admin@example.com'
			}),
			null
		);
		assert.equal(
			readVapidConfiguration({
				VAPID_PUBLIC_KEY: vapidKeys.publicKey,
				VAPID_PRIVATE_KEY: vapidKeys.privateKey,
				VAPID_SUBJECT: 'mailto:'
			}),
			null
		);
	});

	test('rejects placeholders and mismatched key pairs', () => {
		assert.equal(
			readVapidConfiguration({
				VAPID_PUBLIC_KEY: 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY',
				VAPID_PRIVATE_KEY: 'REPLACE_WITH_YOUR_VAPID_PRIVATE_KEY',
				VAPID_SUBJECT: 'mailto:admin@example.com'
			}),
			null
		);

		const otherKeys = webpush.generateVAPIDKeys();
		assert.equal(
			readVapidConfiguration({
				VAPID_PUBLIC_KEY: vapidKeys.publicKey,
				VAPID_PRIVATE_KEY: otherKeys.privateKey,
				VAPID_SUBJECT: 'https://example.com/push-contact'
			}),
			null
		);
	});
});

test('push delivery is handed to the runtime background scheduler', async () => {
	let scheduled: Promise<void> | null = null;
	await scheduleNewMailNotification(
		{
			DB: {} as D1Database,
			waitUntil: (promise) => (scheduled = promise)
		},
		{ emailId: 'mail-1', userId: 'user-1', from: 'sender@example.com', subject: 'Hello' }
	);
	assert.ok(scheduled);
	await scheduled;
});

describe('new-mail push payloads', () => {
	test('contain no message body and link to the stored email', () => {
		const payload = buildNewMailPayload({
			emailId: 'mail/id',
			userId: 'user-1',
			from: 'Ada <ada@example.com>',
			subject: 'Project update'
		});

		assert.deepEqual(payload, {
			title: 'Project update',
			body: 'From Ada <ada@example.com>',
			tag: 'quickmail-mail/id',
			url: '/mail/mail%2Fid'
		});
		assert.equal(JSON.stringify(payload).includes('message body'), false);
	});

	test('recognizes expired subscription responses', () => {
		assert.equal(pushErrorStatus({ statusCode: 410 }), 410);
		assert.equal(pushErrorStatus(new Error('network error')), null);
	});
});

type StoredPushRow = {
	id: string;
	user_id: string;
	endpoint: string;
	updated_at: string;
	rowid: number;
};

function createMemoryPushDb() {
	const rows: StoredPushRow[] = [];
	let nextRowid = 1;
	let clock = 0;

	function prepare(sql: string) {
		let bound: unknown[] = [];
		const statement = {
			bind(...args: unknown[]) {
				bound = args;
				return statement;
			},
			async run() {
				if (sql.includes('INSERT INTO push_subscriptions')) {
					const [id, userId, endpoint] = bound;
					const existing = rows.find((row) => row.endpoint === String(endpoint));
					clock += 1;
					const updated_at = String(clock).padStart(4, '0');
					if (existing) {
						existing.user_id = String(userId);
						existing.updated_at = updated_at;
					} else {
						rows.push({
							id: String(id),
							user_id: String(userId),
							endpoint: String(endpoint),
							updated_at,
							rowid: nextRowid
						});
						nextRowid += 1;
					}
					return { meta: { changes: 1 } };
				}
				if (sql.includes('DELETE FROM push_subscriptions') && sql.includes('WHERE id = ?')) {
					const index = rows.findIndex((row) => row.id === String(bound[0]));
					if (index >= 0) rows.splice(index, 1);
					return { meta: { changes: index >= 0 ? 1 : 0 } };
				}
				throw new Error(`Unexpected SQL: ${sql}`);
			},
			async all() {
				if (!sql.includes('SELECT id FROM push_subscriptions')) {
					throw new Error(`Unexpected SQL: ${sql}`);
				}
				const userId = String(bound[0]);
				const keepEndpoint = String(bound[1]);
				const list = rows
					.filter((row) => row.user_id === userId)
					.sort((left, right) => {
						const keep =
							Number(right.endpoint === keepEndpoint) - Number(left.endpoint === keepEndpoint);
						if (keep !== 0) return keep;
						if (left.updated_at !== right.updated_at) {
							return left.updated_at < right.updated_at ? 1 : -1;
						}
						return right.rowid - left.rowid;
					});
				return { results: list.map((row) => ({ id: row.id })) };
			}
		};
		return statement;
	}

	return {
		db: {
			prepare,
			async batch(statements: Array<{ run: () => Promise<unknown> }>) {
				for (const statement of statements) await statement.run();
			}
		} as unknown as D1Database,
		rows
	};
}

test('caps a user at ten subscriptions and keeps the newest endpoint', async () => {
	const { db, rows } = createMemoryPushDb();
	const keys = { p256dh: vapidKeys.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' };

	for (let index = 0; index < MAX_SUBSCRIPTIONS_PER_USER; index += 1) {
		await savePushSubscription(db, 'user-1', {
			endpoint: `https://push.example.com/subscriptions/device-${index}`,
			expirationTime: null,
			keys
		});
	}

	await savePushSubscription(db, 'user-2', {
		endpoint: 'https://push.example.com/subscriptions/other-user',
		expirationTime: null,
		keys
	});

	await savePushSubscription(db, 'user-1', {
		endpoint: 'https://push.example.com/subscriptions/device-newest',
		expirationTime: null,
		keys
	});

	const userRows = rows.filter((row) => row.user_id === 'user-1');
	assert.equal(userRows.length, MAX_SUBSCRIPTIONS_PER_USER);
	assert.ok(userRows.some((row) => row.endpoint.endsWith('/device-newest')));
	assert.equal(
		userRows.some((row) => row.endpoint.endsWith('/device-0')),
		false
	);
	assert.ok(rows.some((row) => row.user_id === 'user-2'));
});
