import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import {
	base64ByteLength,
	base64ToBytes,
	bytesToBase64,
	getAttachmentForUser,
	insertAttachmentBytes,
	insertAttachments,
	listAttachments,
	normalizeContentId,
	readOutboundAttachments
} from './attachments';
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

test('insertAttachments persists inline disposition and normalized Content-ID', async () => {
	const statements: Array<{ sql: string; bindings: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...bindings: unknown[]) {
					statements.push({ sql, bindings });
					return { async run() {} };
				}
			};
		}
	} as unknown as D1Database;
	const bucket = { async put() {} } as unknown as R2Bucket;

	await insertAttachments(db, bucket, 'email-1', [
		{
			filename: 'logo.svg',
			type: 'image/svg+xml',
			content: 'PHN2ZyAvPg==',
			disposition: 'inline',
			contentId: ' <logo@example.test> '
		}
	]);

	assert.equal(statements.length, 1);
	assert.match(statements[0].sql, /content_disposition, content_id/);
	assert.equal(statements[0].bindings.at(-2), 'inline');
	assert.equal(statements[0].bindings.at(-1), 'logo@example.test');
});

test('insertAttachmentBytes keeps legacy metadata optional', async () => {
	const bindings: unknown[][] = [];
	const db = {
		prepare() {
			return {
				bind(...values: unknown[]) {
					bindings.push(values);
					return { async run() {} };
				}
			};
		}
	} as unknown as D1Database;
	const bucket = { async put() {} } as unknown as R2Bucket;

	await insertAttachmentBytes(db, bucket, 'email-1', {
		filename: 'notes.txt',
		type: 'text/plain',
		bytes: new TextEncoder().encode('a')
	});

	assert.equal(bindings[0].at(-2), null);
	assert.equal(bindings[0].at(-1), null);
});

test('inline SVG metadata survives storage and read-forward conversion while null rows work', async () => {
	const rows = [
		{
			id: 'svg-1',
			email_id: 'email-1',
			filename: 'logo.svg',
			content_type: 'image/svg+xml',
			size_bytes: 7,
			content_disposition: 'inline',
			content_id: '<logo@example.test>',
			storage_key: null,
			content_base64: 'PHN2ZyAvPg==',
			created_at: '2026-01-01'
		},
		{
			id: 'legacy-1',
			email_id: 'email-1',
			filename: 'notes.txt',
			content_type: 'text/plain',
			size_bytes: 1,
			content_disposition: null,
			content_id: null,
			storage_key: null,
			content_base64: 'YQ==',
			created_at: '2026-01-01'
		}
	];
	const db = {
		prepare() {
			return {
				bind() {
					return {
						async all() {
							return { results: rows };
						}
					};
				}
			};
		}
	} as unknown as D1Database;
	const bucket = {} as R2Bucket;

	assert.deepEqual(await readOutboundAttachments(db, bucket, 'user-1', 'email-1'), [
		{
			filename: 'logo.svg',
			type: 'image/svg+xml',
			content: 'PHN2ZyAvPg==',
			disposition: 'inline',
			contentId: 'logo@example.test'
		},
		{ filename: 'notes.txt', type: 'text/plain', content: 'YQ==' }
	]);
});

test('list and get attachment metadata normalize Content-ID values', async () => {
	const row = {
		id: 'file-1',
		email_id: 'email-1',
		filename: 'logo.svg',
		content_type: 'image/svg+xml',
		size_bytes: 7,
		content_disposition: 'inline',
		content_id: '<logo@example.test>',
		storage_key: 'email-1/file-1/logo.svg',
		content_base64: null,
		created_at: '2026-01-01'
	};
	const db = {
		prepare() {
			return {
				bind() {
					return {
						async all() {
							return { results: [row] };
						},
						async first() {
							return row;
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	assert.equal((await listAttachments(db, 'email-1'))[0].content_id, 'logo@example.test');
	assert.equal(
		(await getAttachmentForUser(db, 'user-1', 'email-1', 'file-1'))?.content_id,
		'logo@example.test'
	);
});

test('normalizing Content-ID is tolerant of legacy values and rejects line breaks', () => {
	assert.equal(normalizeContentId(' <logo@example.test> '), 'logo@example.test');
	assert.equal(normalizeContentId('logo@example.test'), 'logo@example.test');
	assert.equal(normalizeContentId(null), null);
	assert.equal(normalizeContentId('  '), null);
	assert.equal(normalizeContentId('logo@example.test\r\nX-Injected: yes'), null);
});
