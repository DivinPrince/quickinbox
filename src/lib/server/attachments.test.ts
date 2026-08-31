import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import { base64ByteLength, base64ToBytes, bytesToBase64 } from './attachments';
import { readForwardedAttachments } from './forward-mail';

describe('attachment encoding', () => {
	test('bytes survive the trip to base64 and back', () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66, 67]);
		assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
	});

	test('a file larger than one chunk is not corrupted or truncated', () => {
		// 0x8000 is the chunk size, so this crosses the boundary several times.
		const bytes = new Uint8Array(0x8000 * 3 + 17);
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

		const round = base64ToBytes(bytesToBase64(bytes));
		assert.equal(round.length, bytes.length);
		assert.deepEqual(round, bytes);
	});

	test('an empty part encodes to an empty string', () => {
		assert.equal(bytesToBase64(new Uint8Array(0)), '');
	});

	test('the reported size matches the bytes encoded, whatever the padding', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 6, 100, 1023]) {
			const bytes = new Uint8Array(length).fill(7);
			assert.equal(base64ByteLength(bytesToBase64(bytes)), length);
		}
	});
});

test('forward-all attachments include every message, can be excluded, and stay user-scoped', async () => {
	const calls: Array<{ emailId: string; userId: string }> = [];
	const db = {
		prepare() {
			return {
				bind(emailId: string, userId: string) {
					calls.push({ emailId, userId });
					return {
						async all() {
							return {
								results: [
									{
										id: `file-${emailId}`,
										email_id: emailId,
										filename: `${emailId}.txt`,
										content_type: 'text/plain',
										size_bytes: 1,
										storage_key: null,
										content_base64: 'YQ==',
										created_at: '2026-01-01'
									}
								]
							};
						}
					};
				}
			};
		}
	} as unknown as D1Database;
	const bucket = {} as R2Bucket;
	const originals = [{ id: 'older' }, { id: 'newer' }] as EmailRow[];

	const included = await readForwardedAttachments(
		{ DB: db, ATTACHMENTS: bucket },
		'user-1',
		originals
	);
	assert.deepEqual(included.map((file) => file.filename), ['older.txt', 'newer.txt']);
	assert.deepEqual(calls, [
		{ emailId: 'older', userId: 'user-1' },
		{ emailId: 'newer', userId: 'user-1' }
	]);

	calls.length = 0;
	assert.deepEqual(
		await readForwardedAttachments(
			{ DB: db, ATTACHMENTS: bucket },
			'user-1',
			originals,
			false
		),
		[]
	);
	assert.deepEqual(calls, []);
});
