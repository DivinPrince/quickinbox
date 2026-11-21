import { describe, expect, test } from 'bun:test';
import { createD1AttachmentBucket, D1_CHUNK_BYTES, resolveAttachmentBucket } from './attachment-store';
import { createTestDb } from './test-db';

function sample(size: number): Uint8Array {
	return Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
}

describe('D1 attachment bucket', () => {
	test('round-trips a multi-chunk object byte for byte', async () => {
		const { db } = createTestDb();
		const bucket = createD1AttachmentBucket(db);
		const bytes = sample(D1_CHUNK_BYTES * 2 + 123);
		await bucket.put('a/b/file.bin', bytes);
		const got = await bucket.get('a/b/file.bin');
		expect(got).not.toBeNull();
		expect(new Uint8Array(await got!.arrayBuffer())).toEqual(bytes);
	});

	test('empty object and missing key', async () => {
		const { db } = createTestDb();
		const bucket = createD1AttachmentBucket(db);
		await bucket.put('empty', new Uint8Array());
		expect(new Uint8Array(await (await bucket.get('empty'))!.arrayBuffer()).length).toBe(0);
		expect(await bucket.get('nope')).toBeNull();
	});

	test('put overwrites, delete removes one or many', async () => {
		const { db } = createTestDb();
		const bucket = createD1AttachmentBucket(db);
		await bucket.put('k', sample(D1_CHUNK_BYTES + 5));
		await bucket.put('k', sample(10));
		expect((await (await bucket.get('k'))!.arrayBuffer()).byteLength).toBe(10);
		await bucket.put('j', sample(3));
		await bucket.delete(['k', 'j']);
		expect(await bucket.get('k')).toBeNull();
		expect(await bucket.get('j')).toBeNull();
		await bucket.delete([]);
	});

	test('resolve prefers a bound R2 bucket, else D1', () => {
		const { db } = createTestDb();
		const r2 = {} as never;
		expect(resolveAttachmentBucket({ DB: db, ATTACHMENTS: r2 })).toBe(r2);
		expect(typeof resolveAttachmentBucket({ DB: db }).put).toBe('function');
	});
});
