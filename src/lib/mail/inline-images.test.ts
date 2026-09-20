import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ATTACHMENT_BYTES } from '$lib/constants';
import { createInlineImage, InlineImageError } from './inline-images';

test('inline image parts preserve binary bytes and get unique Content-IDs', async () => {
	const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
	const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
	const first = await createInlineImage(file);
	const second = await createInlineImage(file);
	assert.deepEqual(Buffer.from(first.content, 'base64'), Buffer.from(bytes));
	assert.equal(first.disposition, 'inline');
	assert.equal(first.filename, 'screenshot.png');
	assert.equal(first.type, 'image/png');
	assert.match(first.contentId!, /^[a-f0-9-]+@quickinbox$/);
	assert.notEqual(first.contentId, second.contentId);
});

test('unsupported, empty, and oversized images are rejected before encoding', async () => {
	for (const [file, reason] of [
		[new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }), 'format'],
		[new File([], 'empty.png', { type: 'image/png' }), 'empty'],
		[new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'big.png', { type: 'image/png' }), 'size']
	] as const) {
		await assert.rejects(createInlineImage(file), (error) => error instanceof InlineImageError && error.reason === reason);
	}
});
