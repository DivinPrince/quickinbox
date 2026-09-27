import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	claimSendAttempt,
	completeSendAttempt,
	failSendAttempt,
	keyAlreadySent,
	readIdempotencyKey,
	SendAttemptError
} from './send-attempts';
import { createTestDb, insertTestUser } from './test-db';

function setup() {
	const { db, sqlite } = createTestDb();
	insertTestUser(sqlite, 'user-1');
	insertTestUser(sqlite, 'user-2');
	return { db, sqlite };
}

describe('claimSendAttempt', () => {
	test('claims a new key once', async () => {
		const { db } = setup();
		const first = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		assert.equal(first.kind, 'claimed');
	});

	test('replays a completed send instead of sending again', async () => {
		const { db } = setup();
		const first = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		await completeSendAttempt(db, first.id, 'email-1', 'provider-1');

		const retry = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		assert.deepEqual(retry, {
			kind: 'replay',
			id: first.id,
			emailId: 'email-1',
			providerId: 'provider-1'
		});
	});

	test('refuses a key reused for different content', async () => {
		const { db } = setup();
		const first = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		await completeSendAttempt(db, first.id, 'email-1', 'provider-1');

		await assert.rejects(
			claimSendAttempt(db, 'user-1', 'key-12345', 'hash-b'),
			(error: unknown) =>
				error instanceof SendAttemptError && error.code === 'idempotency_conflict'
		);
	});

	test('refuses a concurrent retry while the first send is in flight', async () => {
		const { db } = setup();
		await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');

		await assert.rejects(
			claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a'),
			(error: unknown) => error instanceof SendAttemptError && error.code === 'send_in_progress'
		);
	});

	test('lets a failed send be retried, even after the message was edited', async () => {
		const { db, sqlite } = setup();
		const first = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		await failSendAttempt(db, first.id, new Error('Provider rejected the recipient'));

		const retry = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-b');
		assert.deepEqual(retry, { kind: 'claimed', id: first.id });
		const row = sqlite
			.query('SELECT status, request_hash, error FROM send_attempts WHERE id = ?')
			.all(first.id)[0];
		assert.deepEqual(row, { status: 'sending', request_hash: 'hash-b', error: null });
	});

	test('scopes keys to the user', async () => {
		const { db } = setup();
		const mine = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		await completeSendAttempt(db, mine.id, 'email-1', 'provider-1');

		const theirs = await claimSendAttempt(db, 'user-2', 'key-12345', 'hash-b');
		assert.equal(theirs.kind, 'claimed');
		assert.notEqual(theirs.id, mine.id);
	});
});

describe('keyAlreadySent', () => {
	test('is true only once the message went out', async () => {
		const { db } = setup();
		assert.equal(await keyAlreadySent(db, 'user-1', 'key-12345'), false);

		const attempt = await claimSendAttempt(db, 'user-1', 'key-12345', 'hash-a');
		assert.equal(await keyAlreadySent(db, 'user-1', 'key-12345'), false);

		await completeSendAttempt(db, attempt.id, 'email-1', 'provider-1');
		assert.equal(await keyAlreadySent(db, 'user-1', 'key-12345'), true);
		assert.equal(await keyAlreadySent(db, 'user-2', 'key-12345'), false);
	});
});

describe('readIdempotencyKey', () => {
	const withKey = (value?: string) =>
		new Request('https://mail.test/api/mail', {
			method: 'POST',
			headers: value === undefined ? {} : { 'Idempotency-Key': value }
		});

	test('is undefined when the header is absent', () => {
		assert.equal(readIdempotencyKey(withKey()), undefined);
	});

	test('accepts UUIDs and similar opaque keys', () => {
		assert.equal(
			readIdempotencyKey(withKey('0b4c2f5e-8d1a-4c3e-9f6b-2a7d5e1c9b08')),
			'0b4c2f5e-8d1a-4c3e-9f6b-2a7d5e1c9b08'
		);
	});

	test('is null for keys that are too short or carry odd characters', () => {
		assert.equal(readIdempotencyKey(withKey('short')), null);
		assert.equal(readIdempotencyKey(withKey('has spaces in it')), null);
		assert.equal(readIdempotencyKey(withKey('x'.repeat(201))), null);
	});
});
