import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EmailAttachmentMeta } from '$lib/types';
import { resolveInlineImages } from './inline-images';

function attachment(overrides: Partial<EmailAttachmentMeta> = {}): EmailAttachmentMeta {
	return {
		id: 'att-1',
		email_id: 'mail-1',
		filename: 'shot.jpg',
		content_type: 'image/jpeg',
		size_bytes: 100,
		created_at: '2026-01-01T00:00:00.000Z',
		content_id: 'ii_123',
		...overrides
	};
}

describe('resolveInlineImages', () => {
	test('points a cid reference at the stored attachment', () => {
		const html = '<img src="cid:ii_123" style="max-width: 100%">';
		assert.equal(
			resolveInlineImages(html, 'mail-1', [attachment()]),
			'<img src="/api/mail/mail-1/attachments/att-1" style="max-width: 100%">'
		);
	});

	test('matches regardless of angle brackets and case', () => {
		// Senders wrap the Content-ID in the header but not in the body.
		const html = "<img src='cid:II_123'>";
		assert.equal(
			resolveInlineImages(html, 'mail-1', [attachment({ content_id: '<ii_123>' })]),
			"<img src='/api/mail/mail-1/attachments/att-1'>"
		);
	});

	test('rewrites a css url() reference', () => {
		const html = '<div style="background: url(cid:ii_123)"></div>';
		assert.equal(
			resolveInlineImages(html, 'mail-1', [attachment()]),
			'<div style="background: url(/api/mail/mail-1/attachments/att-1)"></div>'
		);
	});

	test('falls back to the only image when no Content-ID was stored', () => {
		// Mail received before the Content-ID column existed.
		const html = '<img src="cid:ii_unknown">';
		assert.equal(
			resolveInlineImages(html, 'mail-1', [attachment({ content_id: null })]),
			'<img src="/api/mail/mail-1/attachments/att-1">'
		);
	});

	test('does not guess when the pairing is ambiguous', () => {
		const html = '<img src="cid:a"><img src="cid:b">';
		const two = [
			attachment({ id: 'att-1', content_id: null }),
			attachment({ id: 'att-2', content_id: null })
		];
		assert.equal(resolveInlineImages(html, 'mail-1', two), html);
	});

	test('leaves an unmatched reference untouched', () => {
		const html = '<img src="cid:missing">';
		const others = [
			attachment({ id: 'att-1', content_id: 'other-1' }),
			attachment({ id: 'att-2', content_id: 'other-2' })
		];
		assert.equal(resolveInlineImages(html, 'mail-1', others), html);
	});

	test('ignores the characters cid: in ordinary prose', () => {
		const html = '<p>write cid:something in the ticket</p>';
		assert.equal(resolveInlineImages(html, 'mail-1', [attachment()]), html);
	});

	test('handles a body with no references and an empty body', () => {
		assert.equal(resolveInlineImages('<p>hi</p>', 'mail-1', [attachment()]), '<p>hi</p>');
		assert.equal(resolveInlineImages(null, 'mail-1', []), '');
	});
});
