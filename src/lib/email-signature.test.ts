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
