import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildForwardedMessage,
	buildForwardedMessages,
	formatForwardDate,
	forwardSubject
} from './forward';

const original = {
	from_addr: 'ada@example.com',
	to_addr: 'support@ourdomain.test',
	cc_addr: 'grace@example.com',
	subject: 'Quarterly figures',
	body_text: 'The numbers are attached.',
	body_html: '<p>The numbers are attached.</p>',
	created_at: '2026-08-24 08:30:00'
};

describe('forwarding a message', () => {
	test('the subject is marked as a forward', () => {
		assert.equal(forwardSubject('Quarterly figures'), 'Fwd: Quarterly figures');
	});

	test('a message that is already a forward is not marked twice', () => {
		assert.equal(forwardSubject('Fwd: Quarterly figures'), 'Fwd: Quarterly figures');
		assert.equal(forwardSubject('FW: Quarterly figures'), 'FW: Quarterly figures');
		assert.equal(forwardSubject('Fwd[2]: Quarterly figures'), 'Fwd[2]: Quarterly figures');
	});

	test('a reply being forwarded keeps its own prefix and gains one', () => {
		assert.equal(forwardSubject('Re: Quarterly figures'), 'Fwd: Re: Quarterly figures');
	});

	test('stored timestamps are read as UTC, not as local time', () => {
		assert.equal(formatForwardDate('2026-08-24 08:30:00'), 'Mon, 24 Aug 2026 08:30:00 GMT');
	});

	test('an unreadable timestamp is passed through rather than dropped', () => {
		assert.equal(formatForwardDate('sometime'), 'sometime');
	});

	test('the forwarded message carries the headers it arrived with', () => {
		const { text } = buildForwardedMessage(original);

		assert.match(text, /^---------- Forwarded message ----------/);
		assert.match(text, /From: ada@example\.com/);
		assert.match(text, /Date: Mon, 24 Aug 2026 08:30:00 GMT/);
		assert.match(text, /Subject: Quarterly figures/);
		assert.match(text, /To: support@ourdomain\.test/);
		assert.match(text, /Cc: grace@example\.com/);
		assert.match(text, /The numbers are attached\./);
	});

	test('a message nobody was copied on carries no Cc line', () => {
		const { text } = buildForwardedMessage({ ...original, cc_addr: null });
		assert.equal(text.includes('Cc:'), false);
	});

	test('a note is placed above the forwarded message in both forms', () => {
		const { text, html } = buildForwardedMessage(original, {
			note: { text: 'See below.', html: '<p>See below.</p>' }
		});

		assert.match(text, /^See below\.\n\n---------- Forwarded message/);
		assert.match(html, /^<p>See below\.<\/p><div class="gmail_quote">/);
	});

	test('a note written only as text still reaches the HTML part', () => {
		const { text, html } = buildForwardedMessage(original, {
			note: { text: 'See below.\nThanks.' }
		});

		assert.match(text, /^See below\.\nThanks\.\n\n---------- Forwarded message/);
		assert.match(html, /^<p>See below\.<br>\nThanks\.<\/p><div class="gmail_quote">/);
	});

	test('a note written only as HTML still reaches the text part', () => {
		const { text, html } = buildForwardedMessage(original, {
			note: { html: '<p>See below.</p>' }
		});

		assert.match(text, /^See below\.\n\n---------- Forwarded message/);
		assert.match(html, /^<p>See below\.<\/p><div class="gmail_quote">/);
	});

	test('a text note is escaped rather than treated as markup', () => {
		const { html } = buildForwardedMessage(original, {
			note: { text: '<img src=x onerror="alert(1)">' }
		});

		assert.equal(html.includes('<img src=x'), false);
		assert.match(html, /&lt;img src=x/);
	});

	test('no note leaves the forwarded message at the top', () => {
		const { html } = buildForwardedMessage(original);
		assert.match(html, /^<div class="gmail_quote">/);
	});

	test('the forwarded part is wrapped so a reader can fold it', () => {
		const { html } = buildForwardedMessage(original);
		assert.match(html, /<div class="gmail_quote">/);
		assert.match(html, /<p>The numbers are attached\.<\/p>/);
	});

	test('header values are escaped so a crafted subject cannot inject markup', () => {
		const { html } = buildForwardedMessage({
			...original,
			subject: '<img src=x onerror="alert(1)">'
		});

		assert.equal(html.includes('<img src=x'), false);
		assert.match(html, /&lt;img src=x/);
	});

	test('a message held only as HTML still forwards as readable text', () => {
		const { text } = buildForwardedMessage({
			...original,
			body_text: null,
			body_html: '<p>Hello</p><p>Goodbye</p>'
		});

		assert.match(text, /Hello\nGoodbye/);
	});

	test('a message held only as text still forwards as HTML', () => {
		const { html } = buildForwardedMessage({
			...original,
			body_text: 'Line one\nLine two',
			body_html: null
		});

		assert.match(html, /Line one<br>\nLine two/);
	});

	test('forward all includes each message once in chronological order', () => {
		const older = { ...original, subject: 'Original subject', body_text: 'OLDER-BODY' };
		const newer = {
			...original,
			from_addr: 'grace@example.com',
			to_addr: 'ada@example.com',
			cc_addr: null,
			subject: 'Re: Original subject',
			body_text: 'NEWER-BODY',
			body_html: null,
			created_at: '2026-08-24 09:30:00'
		};
		const { subject, text, html } = buildForwardedMessages([newer, older]);

		assert.equal(subject, 'Fwd: Original subject');
		assert.ok(text.indexOf('OLDER-BODY') < text.indexOf('NEWER-BODY'));
		assert.ok(html.indexOf('The numbers are attached.') < html.indexOf('NEWER-BODY'));
		assert.equal(text.split('OLDER-BODY').length - 1, 1);
		assert.equal(text.split('NEWER-BODY').length - 1, 1);
		assert.equal(text.split('---------- Forwarded message ----------').length - 1, 2);
	});

	test('forward all preserves visible headers and never exposes Bcc', () => {
		const withBcc = { ...original, bcc_addr: 'secret@example.com' };
		const { text, html } = buildForwardedMessages([withBcc]);

		for (const expected of [
			'From: ada@example.com',
			'Date: Mon, 24 Aug 2026 08:30:00 GMT',
			'To: support@ourdomain.test',
			'Cc: grace@example.com',
			'Subject: Quarterly figures',
			'The numbers are attached.'
		]) {
			assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		}
		assert.equal(text.includes('Bcc:'), false);
		assert.equal(html.includes('Bcc:'), false);
		assert.equal(text.includes('secret@example.com'), false);
		assert.equal(html.includes('secret@example.com'), false);
	});
});
