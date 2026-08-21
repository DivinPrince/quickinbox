import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applicationServerKeyMatches,
	base64UrlToApplicationServerKey,
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
