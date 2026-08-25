import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inboundSender } from './cloudflare-inbound';

describe('inboundSender', () => {
	test('prefers the From: header over the bounce envelope sender', () => {
		// Cloudflare Email Sending puts bounces@cf-bounce.<domain> in MAIL FROM, so
		// mail between two addresses on the same instance arrives with an envelope
		// sender that is not the author. Taking it would mis-attribute the message
		// and point replies at the bounce mailbox.
		assert.equal(
			inboundSender('alice@example.com', 'bounces@cf-bounce.example.com'),
			'alice@example.com'
		);
	});

	test('falls back to the envelope sender when there is no From: header', () => {
		assert.equal(inboundSender(undefined, 'someone@example.com'), 'someone@example.com');
		assert.equal(inboundSender('', 'someone@example.com'), 'someone@example.com');
	});

	test('falls back when the From: header yields no address', () => {
		// Blank and malformed headers are still truthy strings, so the choice has
		// to turn on whether an address came out of them.
		assert.equal(inboundSender('   ', 'someone@example.com'), 'someone@example.com');
		assert.equal(inboundSender('<>', 'someone@example.com'), 'someone@example.com');
		assert.equal(
			inboundSender('undisclosed-recipients', 'someone@example.com'),
			'someone@example.com'
		);
	});

	test('unwraps a display name', () => {
		assert.equal(inboundSender('Grace Hopper <grace@example.com>', ''), 'grace@example.com');
	});

	test('normalises case', () => {
		assert.equal(inboundSender('Grace@Example.COM', ''), 'grace@example.com');
	});

	test('returns an empty string when neither is present', () => {
		assert.equal(inboundSender(undefined, undefined), '');
	});
});
