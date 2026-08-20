import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import webpush from 'web-push';
import {
	buildNewMailPayload,
	parsePushSubscription,
	pushErrorStatus,
	readVapidConfiguration,
	scheduleNewMailNotification
} from './push-notifications';

const vapidKeys = webpush.generateVAPIDKeys();

const validSubscription = {
	endpoint: 'https://push.example.com/subscriptions/device-1',
	expirationTime: null,
	keys: {
		p256dh: vapidKeys.publicKey,
		auth: 'tBHItJI5svbpez7KI4CCXg'
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
