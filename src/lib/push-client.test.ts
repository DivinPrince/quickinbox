import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applicationServerKeyMatches,
	base64UrlToApplicationServerKey,
	pushSubscriptionPayload,
	subscriptionUsesPublicKey
} from './push-client';

test('converts URL-safe VAPID keys to bytes', () => {
	const bytes = new Uint8Array(base64UrlToApplicationServerKey('AQID-v8'));
	assert.deepEqual([...bytes], [1, 2, 3, 250, 255]);
});

test('detects subscriptions created with another VAPID key', () => {
	const current = base64UrlToApplicationServerKey('AQID-v8');
	assert.equal(applicationServerKeyMatches(current, 'AQID-v8'), true);
	assert.equal(applicationServerKeyMatches(current, 'AQID-v4'), false);
	assert.equal(applicationServerKeyMatches(null, 'AQID-v8'), false);

	const subscription = {
		options: { applicationServerKey: current }
	} as Pick<PushSubscription, 'options'> as PushSubscription;
	assert.equal(subscriptionUsesPublicKey(subscription, 'AQID-v8'), true);
});

test('treats subscriptions without options as matching', () => {
	// Safari resolves plain JSON-shaped subscription objects without options.
	const subscription = { endpoint: 'https://web.push.apple.com/device' } as PushSubscription;
	assert.equal(subscriptionUsesPublicKey(subscription, 'AQID-v8'), true);
});

test('rejects subscriptions carrying a null application server key', () => {
	const subscription = {
		endpoint: 'https://web.push.apple.com/device',
		options: { applicationServerKey: null }
	} as unknown as PushSubscription;
	assert.equal(subscriptionUsesPublicKey(subscription, 'AQID-v8'), false);
});

test('serializes subscriptions via toJSON when available', () => {
	const subscription = {
		endpoint: 'https://fcm.googleapis.com/device',
		expirationTime: null,
		toJSON: () => ({
			endpoint: 'https://fcm.googleapis.com/device',
			expirationTime: null,
			keys: { p256dh: 'key', auth: 'secret' }
		})
	} as unknown as PushSubscription;
	assert.equal(
		pushSubscriptionPayload(subscription),
		'{"endpoint":"https://fcm.googleapis.com/device","expirationTime":null,"keys":{"p256dh":"key","auth":"secret"}}'
	);
});

test('serializes with getKey when toJSON is missing', () => {
	const subscription = {
		endpoint: 'https://web.push.apple.com/device',
		getKey: (name: string) =>
			name === 'p256dh'
				? new Uint8Array([1, 2, 3, 250, 255]).buffer
				: name === 'auth'
					? new Uint8Array([9]).buffer
					: null
	} as unknown as PushSubscription;
	assert.equal(
		pushSubscriptionPayload(subscription),
		'{"endpoint":"https://web.push.apple.com/device","expirationTime":null,"keys":{"p256dh":"AQID-v8","auth":"CQ"}}'
	);
});

test('reads plain keys from Safari-shaped subscriptions', () => {
	const subscription = {
		endpoint: 'https://web.push.apple.com/device',
		keys: { p256dh: 'key', auth: 'secret' }
	} as unknown as PushSubscription;
	const parsed = JSON.parse(pushSubscriptionPayload(subscription)) as Record<string, unknown>;
	assert.deepEqual(parsed.keys, { p256dh: 'key', auth: 'secret' });
});

test('reads ArrayBuffer keys from Safari-shaped subscriptions', () => {
	const subscription = {
		endpoint: 'https://web.push.apple.com/device',
		keys: { p256dh: new Uint8Array([1, 2, 3, 250, 255]).buffer, auth: new Uint8Array([9]).buffer }
	} as unknown as PushSubscription;
	const parsed = JSON.parse(pushSubscriptionPayload(subscription)) as {
		keys: Record<string, string>;
	};
	assert.equal(parsed.keys.p256dh, 'AQID-v8');
	assert.equal(parsed.keys.auth, 'CQ');
});

test('rejects subscriptions without readable keys', () => {
	const subscription = { endpoint: 'https://web.push.apple.com/device' } as PushSubscription;
	assert.throws(() => pushSubscriptionPayload(subscription), /unreadable push subscription/);
});
