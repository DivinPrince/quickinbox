import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Attachment } from 'postal-mime';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from './constants';
import { inboundSender, storeInboundAttachments } from './cloudflare-inbound';

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

function mockEnv(options: { failPut?: boolean } = {}) {
	const bucket = {
		async put() {
			if (options.failPut) throw new Error('R2 unavailable');
		}
	} as unknown as R2Bucket;

	const db = {
		prepare() {
			return {
				bind() {
					return { async run() {} };
				}
			};
		}
	} as unknown as D1Database;

	return { DB: db, ATTACHMENTS: bucket };
}

function parsed(count: number, byteLength = 10): Attachment[] {
	return Array.from({ length: count }, (_, i) => ({
		filename: `file-${i}.txt`,
		mimeType: 'text/plain',
		disposition: 'attachment',
		content: new ArrayBuffer(byteLength)
	})) as unknown as Attachment[];
}

describe('storeInboundAttachments (Cloudflare)', () => {
	test('returns how many attachments were stored', async () => {
		assert.equal(await storeInboundAttachments(mockEnv(), 'email-1', parsed(3)), 3);
	});

	test('does not count empty or oversized parts', async () => {
		// The count is what the reader can actually open, so parts we drop must
		// not appear in the notification.
		assert.equal(await storeInboundAttachments(mockEnv(), 'email-1', parsed(1, 0)), 0);
		assert.equal(
			await storeInboundAttachments(mockEnv(), 'email-1', parsed(1, MAX_ATTACHMENT_BYTES + 1)),
			0
		);
	});

	test('does not count an attachment whose storage fails', async () => {
		assert.equal(await storeInboundAttachments(mockEnv({ failPut: true }), 'email-1', parsed(2)), 0);
	});

	test('counts no more than the per-message cap', async () => {
		assert.equal(
			await storeInboundAttachments(mockEnv(), 'email-1', parsed(MAX_ATTACHMENTS_PER_EMAIL + 3)),
			MAX_ATTACHMENTS_PER_EMAIL
		);
	});

	test('handles a message with no attachments', async () => {
		assert.equal(await storeInboundAttachments(mockEnv(), 'email-1', []), 0);
	});
});
