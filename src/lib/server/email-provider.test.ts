import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailAddress } from '$lib/types';
import type { EmailProvider } from './email-provider';
import { parseMailDomains } from './email-provider';
import {
	createCloudflareProvider,
	type CloudflareSendPayload
} from './providers/cloudflare-provider';
import { createResendProvider } from './providers/resend-provider';
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

const providerTestFrom: MailAddress = {
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

const inlineSvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="4"/></svg>';
const inlineSvgBase64 = Buffer.from(inlineSvg).toString('base64');
const ordinaryFile = 'plain attachment';
const ordinaryFileBase64 = Buffer.from(ordinaryFile).toString('base64');

function providerAttachmentInput(): OutboundMailInput {
	// Keep the ordinary part free of metadata to verify the provider default.
	const attachments = [
		{
			filename: 'logo.svg',
			type: 'image/svg+xml',
			content: inlineSvgBase64,
			disposition: 'inline' as const,
			contentId: 'logo@example.com'
		},
		{
			filename: 'notes.txt',
			type: 'text/plain',
			content: ordinaryFileBase64
		}
	];

	return {
		from: providerTestFrom,
		senderName: 'Me',
		to: ['recipient@example.com'],
		subject: 'Attachment metadata',
		text: 'See the files.',
		html: '<p>See the logo.</p><img src="cid:logo@example.com" alt="Logo">',
		attachments
	};
}

test('Resend sends CID SVGs inline and leaves ordinary files without content_id', async () => {
	let requestBody:
		| { html?: string; attachments?: Array<Record<string, unknown>> }
		| undefined;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) => {
		requestBody = JSON.parse(String(init?.body)) as {
			html?: string;
			attachments?: Array<Record<string, unknown>>;
		};
		return new Response(JSON.stringify({ id: 'resend-message-id' }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	};

	try {
		const result = await createResendProvider('test-resend-key').send(providerAttachmentInput());
		assert.equal(result.providerId, 'resend-message-id');
	} finally {
		globalThis.fetch = originalFetch;
	}

	const attachments = requestBody?.attachments;
	assert.ok(attachments);
	assert.match(requestBody?.html ?? '', /src="cid:logo@example\.com"/);
	assert.deepEqual(attachments[0], {
		filename: 'logo.svg',
		content: inlineSvgBase64,
		content_type: 'image/svg+xml',
		content_id: 'logo@example.com'
	});
	assert.deepEqual(attachments[1], {
		filename: 'notes.txt',
		content: ordinaryFileBase64,
		content_type: 'text/plain'
	});
});

test('Cloudflare sends CID SVGs inline and ordinary files as attachments', async () => {
	let payload: CloudflareSendPayload | undefined;
	const provider = createCloudflareProvider(
		{
			async send(nextPayload) {
				payload = nextPayload;
				return { messageId: 'cloudflare-message-id' };
			}
		},
		'example.com'
	);

	const result = await provider.send(providerAttachmentInput());
	assert.equal(result.providerId, 'cloudflare-message-id');

	const attachments = payload?.attachments;
	assert.ok(attachments);
	assert.match(payload?.html ?? '', /src="cid:logo@example\.com"/);
	assert.equal(attachments.length, 2);

	const inlineAttachment = attachments[0];
	assert.equal(inlineAttachment.filename, 'logo.svg');
	assert.equal(inlineAttachment.type, 'image/svg+xml');
	assert.equal(inlineAttachment.disposition, 'inline');
	if (inlineAttachment.disposition === 'inline') {
		assert.equal(inlineAttachment.contentId, 'logo@example.com');
	}
	assert.deepEqual(
		new Uint8Array(inlineAttachment.content as ArrayBuffer),
		new Uint8Array(Buffer.from(inlineSvg))
	);

	const ordinaryAttachment = attachments[1];
	assert.equal(ordinaryAttachment.filename, 'notes.txt');
	assert.equal(ordinaryAttachment.type, 'text/plain');
	assert.equal(ordinaryAttachment.disposition, 'attachment');
	assert.equal(ordinaryAttachment.contentId, undefined);
	assert.deepEqual(
		new Uint8Array(ordinaryAttachment.content as ArrayBuffer),
		new Uint8Array(Buffer.from(ordinaryFile))
	);
});
