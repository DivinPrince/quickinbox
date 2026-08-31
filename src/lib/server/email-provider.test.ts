import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailAddress } from '$lib/types';
import type { EmailProvider } from './email-provider';
import { parseMailDomains } from './email-provider';
import { sendOutboundEmail, type OutboundMailInput } from './send-mail';

describe('parseMailDomains', () => {
	test('splits comma-separated domains and lowercases them', () => {
		assert.deepEqual(parseMailDomains('Mail.Yours.com, YourDomain.com'), [
			'mail.yours.com',
			'yourdomain.com'
		]);
	});

	test('ignores the dashboard placeholder so Resend deploys can leave example.com', () => {
		assert.deepEqual(parseMailDomains('example.com'), []);
		assert.deepEqual(parseMailDomains('example.com, mail.example.com'), ['mail.example.com']);
	});

	test('returns an empty list for blank values', () => {
		assert.deepEqual(parseMailDomains(''), []);
		assert.deepEqual(parseMailDomains('   '), []);
		assert.deepEqual(parseMailDomains(null), []);
	});
});

test('a forwarded send uses its selected identity and has no reply-chain headers', async () => {
	let sent: OutboundMailInput | undefined;
	const provider: EmailProvider = {
		kind: 'resend',
		async send(input) {
			sent = input;
			return { providerId: 'provider-id' };
		},
		async listDomains() {
			return [];
		},
		async getDomain() {
			throw new Error('unused');
		}
	};
	const from: MailAddress = {
		id: 'address-1',
		user_id: 'user-1',
		domain_id: 'domain-1',
		domain_name: 'example.com',
		address: 'me@example.com',
		label: 'Me',
		is_default: true,
		signature: null,
		created_at: '2026-01-01'
	};

	await sendOutboundEmail(provider, {
		from,
		senderName: 'Me',
		to: 'recipient@example.com',
		subject: 'Fwd: Original',
		text: 'Forwarded message'
	});

	assert.equal(sent?.from.address, 'me@example.com');
	assert.equal(sent?.inReplyTo, undefined);
	assert.equal(sent?.references, undefined);
	assert.equal(sent?.headers, undefined);
});
