import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appendEmailSignature,
	MAX_EMAIL_SIGNATURE_LENGTH,
	normalizeEmailSignature,
	parseMailboxSignature,
	pickEmailSignature
} from './email-signature';

	describe('email signatures', () => {
	test('normalizes line endings and trailing whitespace', () => {
		assert.equal(
			normalizeEmailSignature('  Best,  \r\nEmmanuel  \r\n'),
			'Best,\nEmmanuel'
		);
	});

	test('appends a sign-off to plain text and HTML', () => {
		assert.deepEqual(
			appendEmailSignature({
				text: 'Hello there',
				html: '<p>Hello there</p>',
				signature: 'Best,\nEmmanuel'
			}),
			{
				text: 'Hello there\n\nBest,\nEmmanuel',
				html:
					'<p>Hello there</p>\n<div><br></div>\n<div data-email-signature="true">Best,<br>\nEmmanuel</div>'
			}
		);
	});

	test('escapes signature text before adding it to HTML', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<p>Hello</p>',
			signature: '<Emmanuel & Co>'
		});

		assert.match(result.html ?? '', /&lt;Emmanuel &amp; Co&gt;/);
		assert.doesNotMatch(result.html ?? '', /<Emmanuel & Co>/);
	});

	test('keeps the signature inside a complete HTML document', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<!doctype html><html><body><p>Hello</p></body></html>',
			signature: 'Best,\nEmmanuel'
		});

		assert.match(result.html ?? '', /data-email-signature="true"[\s\S]*<\/body><\/html>$/);
		assert.doesNotMatch(result.html ?? '', /<\/html>[\s\S]+data-email-signature/);
	});

	test('finds the closing body tag whatever its case', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<HTML><BODY><p>Hello</p></BODY ></HTML>',
			signature: 'Best'
		});

		assert.match(result.html ?? '', /data-email-signature="true">Best<\/div>\n<\/BODY ><\/HTML>$/);
	});

	test('keeps dollar signs in the signature literal inside a document', () => {
		const result = appendEmailSignature({
			text: 'Hello',
			html: '<html><body><p>Hello</p></body></html>',
			signature: 'Plans from $5 — $& $$ $1'
		});

		assert.match(result.html ?? '', /Plans from \$5 — \$&amp; \$\$ \$1<\/div>\n<\/body><\/html>$/);
	});

	test('appends after a fragment that quotes a complete document, as a forward does', () => {
		const forwarded =
			'<p>See below</p><div class="gmail_quote"><html><body><p>Original</p></body></html></div>';
		const result = appendEmailSignature({ text: 'See below', html: forwarded, signature: 'Best' });

		assert.equal(
			result.html,
			`${forwarded}\n<div><br></div>\n<div data-email-signature="true">Best</div>`
		);
	});

	test('appends after a forward whose note is itself a complete document', () => {
		const forwarded =
			'<html><body><p>Note</p></body></html><div class="gmail_quote"><html><body><p>Original</p></body></html></div>';
		const result = appendEmailSignature({ text: 'Note', html: forwarded, signature: 'Best' });

		assert.equal(
			result.html,
			`${forwarded}\n<div><br></div>\n<div data-email-signature="true">Best</div>`
		);
	});

	test('uses the outer closing body tag when a document quotes another', () => {
		const result = appendEmailSignature({
			text: 'Hi',
			html: '<!DOCTYPE html><html><body><p>Hi</p><blockquote><html><body>Old</body></html></blockquote></body></html>',
			signature: 'Best'
		});

		assert.match(
			result.html ?? '',
			/<\/blockquote><div><br><\/div>\n<div data-email-signature="true">Best<\/div>\n<\/body><\/html>$/
		);
	});

	test('ends a document whose own closing body tag is omitted, not the message it quotes', () => {
		const result = appendEmailSignature({
			text: 'Hi',
			html: '<html><body>Hi<blockquote><html><body>Old</body></html></blockquote></html>',
			signature: 'Best'
		});

		assert.match(result.html ?? '', /<\/blockquote><div><br><\/div>\n<div data-email-signature="true">Best<\/div>\n<\/html>$/);
	});

	test('ignores a closing body tag inside a trailing comment', () => {
		const result = appendEmailSignature({
			text: 'Hi',
			html: '<html><body>Hi</body><!-- </body> --></html>',
			signature: 'Best'
		});

		assert.match(result.html ?? '', /<!-- <\/body> --><div><br><\/div>\n<div data-email-signature="true">Best<\/div>\n<\/html>$/);
	});

	test('stays inside a document that has no closing body tag', () => {
		const result = appendEmailSignature({
			text: 'Hi',
			html: '<html><body><p>Hi</p></html>',
			signature: 'Best'
		});

		assert.match(result.html ?? '', /<p>Hi<\/p><div><br><\/div>\n<div data-email-signature="true">Best<\/div>\n<\/html>$/);
	});

	test('leaves the message unchanged when the signature is empty', () => {
		assert.deepEqual(
			appendEmailSignature({ text: 'Hello', html: '<p>Hello</p>', signature: '   ' }),
			{ text: 'Hello', html: '<p>Hello</p>' }
		);
	});

	test('picks a mailbox signature over the account signature', () => {
		assert.equal(pickEmailSignature('Support', 'Best,\nEmmanuel'), 'Support');
		assert.equal(pickEmailSignature('  ', 'Best,\nEmmanuel'), 'Best,\nEmmanuel');
		assert.equal(pickEmailSignature(null, ''), '');
	});

	test('rejects mailbox signatures over the character limit', () => {
		assert.equal(parseMailboxSignature('  Best  '), 'Best');
		assert.equal(parseMailboxSignature('   '), null);
		assert.equal(parseMailboxSignature('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH))?.length, 1000);
		assert.throws(
			() => parseMailboxSignature('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH + 1)),
			/1000 characters or fewer/
		);
	});
});
