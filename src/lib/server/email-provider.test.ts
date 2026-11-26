import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailAddress } from '$lib/types';
import type { EmailProvider } from './email-provider';
import {
	parseMailDomains,
	parseProviderKind,
	resolveMailKind,
	ProviderError,
	withInbound,
	withoutSending,
	type ProviderDomain
} from './email-provider';
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

describe('resolveMailKind: EMAIL_INBOUND / EMAIL_OUTBOUND over legacy EMAIL_PROVIDER', () => {
	const kinds = (env: Record<string, string | undefined>) => [
		resolveMailKind(env, 'inbound').kind,
		resolveMailKind(env, 'outbound').kind
	];

	test('nothing set behaves like before: Resend both ways', () => {
		assert.deepEqual(kinds({}), ['resend', 'resend']);
		assert.deepEqual(kinds({ EMAIL_PROVIDER: '' }), ['resend', 'resend']);
	});

	test('EMAIL_PROVIDER alone still sets both directions', () => {
		assert.deepEqual(kinds({ EMAIL_PROVIDER: 'cloudflare' }), ['cloudflare', 'cloudflare']);
		assert.deepEqual(kinds({ EMAIL_PROVIDER: ' Resend ' }), ['resend', 'resend']);
	});

	test('the new settings override each direction independently', () => {
		const env = { EMAIL_PROVIDER: 'resend', EMAIL_INBOUND: 'cloudflare' };
		assert.deepEqual(kinds(env), ['cloudflare', 'resend']);
		assert.deepEqual(kinds({ EMAIL_INBOUND: 'cloudflare', EMAIL_OUTBOUND: 'resend' }), ['cloudflare', 'resend']);
		assert.deepEqual(kinds({ EMAIL_PROVIDER: 'cloudflare', EMAIL_OUTBOUND: 'resend' }), ['cloudflare', 'resend']);
	});

	test('none or off turns one direction off, an empty value falls back to EMAIL_PROVIDER', () => {
		assert.deepEqual(kinds({ EMAIL_PROVIDER: 'resend', EMAIL_OUTBOUND: 'none' }), ['resend', null]);
		assert.deepEqual(kinds({ EMAIL_PROVIDER: 'resend', EMAIL_INBOUND: 'OFF' }), [null, 'resend']);
		assert.deepEqual(kinds({ EMAIL_PROVIDER: 'cloudflare', EMAIL_INBOUND: '' }), ['cloudflare', 'cloudflare']);
	});

	test('unknown values are invalid and name the setting that caused it', () => {
		const inbound = resolveMailKind({ EMAIL_INBOUND: 'smtp' }, 'inbound');
		assert.equal(inbound.valid, false);
		assert.equal(inbound.name, 'EMAIL_INBOUND');
		const legacy = resolveMailKind({ EMAIL_PROVIDER: 'smtp' }, 'outbound');
		assert.equal(legacy.valid, false);
		assert.equal(legacy.name, 'EMAIL_PROVIDER');
		// A valid explicit setting is not poisoned by a bad legacy one.
		assert.equal(resolveMailKind({ EMAIL_PROVIDER: 'smtp', EMAIL_OUTBOUND: 'resend' }, 'outbound').valid, true);
	});
});

describe('explicit inbound / outbound providers', () => {
	test('parseProviderKind: empty, none and off mean no service', () => {
		assert.deepEqual(parseProviderKind('resend'), { kind: 'resend', valid: true });
		assert.deepEqual(parseProviderKind(' Cloudflare '), { kind: 'cloudflare', valid: true });
		for (const off of [undefined, null, '', '   ', 'none', 'OFF']) {
			assert.deepEqual(parseProviderKind(off), { kind: null, valid: true });
		}
		assert.deepEqual(parseProviderKind('smtp'), { kind: null, valid: false });
	});

	const resendDomain: ProviderDomain = {
		id: 'resend-domain-id',
		name: 'Yours.com',
		status: 'verified',
		region: 'eu-west-1',
		sendingEnabled: true,
		receivingEnabled: false
	};
	const resendLike: EmailProvider = {
		kind: 'resend',
		async send() {
			return { providerId: 'x' };
		},
		async listDomains() {
			return [resendDomain];
		},
		async getDomain() {
			return resendDomain;
		}
	};

	test('Cloudflare inbound marks routed domains as receiving even though Resend has it off', async () => {
		const provider = withInbound(resendLike, 'cloudflare', 'yours.com');
		assert.equal(provider.kind, 'resend');
		const domain = await provider.getDomain('resend-domain-id');
		assert.equal((await provider.listDomains())[0].receivingEnabled, true);
		assert.equal(domain.receivingEnabled, true);
		// Identity and sending state stay Resend's.
		assert.equal(domain.id, 'resend-domain-id');
		assert.equal(domain.sendingEnabled, true);
	});

	test('a domain missing from CLOUDFLARE_MAIL_DOMAINS is not reported as receiving', async () => {
		for (const list of ['other.com', undefined, '']) {
			const provider = withInbound(resendLike, 'cloudflare', list);
			assert.equal((await provider.listDomains())[0].receivingEnabled, false);
		}
	});

	const cloudflareLister: EmailProvider = {
		...resendLike,
		kind: 'cloudflare',
		async listDomains() {
			return [{ ...resendDomain, id: 'cf-id', name: 'yours.com', receivingEnabled: true }];
		},
		async getDomain() {
			return { ...resendDomain, id: 'cf-id', name: 'yours.com', receivingEnabled: true };
		}
	};
	const resendSays = (receivingEnabled: boolean) => async () => [
		{ ...resendDomain, name: 'Yours.com.', receivingEnabled }
	];

	test('Resend inbound with another lister asks Resend, matching names loosely', async () => {
		const on = withInbound(cloudflareLister, 'resend', 'yours.com', resendSays(true));
		const domain = await on.getDomain('cf-id');
		assert.equal(domain.receivingEnabled, true);
		// Identity and sending stay the lister's.
		assert.equal(domain.id, 'cf-id');
		assert.equal(domain.sendingEnabled, true);
		assert.equal((await on.listDomains())[0].receivingEnabled, true);

		const off = withInbound(cloudflareLister, 'resend', 'yours.com', resendSays(false));
		assert.equal((await off.listDomains())[0].receivingEnabled, false);
	});

	test('Resend inbound with another lister: an unknown domain, or no lookup, is not receiving', async () => {
		const unknown = withInbound(cloudflareLister, 'resend', 'yours.com', async () => []);
		assert.equal((await unknown.listDomains())[0].receivingEnabled, false);
		const noLookup = withInbound(cloudflareLister, 'resend', 'yours.com');
		assert.equal((await noLookup.getDomain('cf-id')).receivingEnabled, false);
	});

	test('a failed Resend lookup is an error, never a saved "not receiving"', async () => {
		const failing = withInbound(cloudflareLister, 'resend', 'yours.com', async () => {
			throw new Error('network');
		});
		for (const read of [() => failing.listDomains(), () => failing.getDomain('cf-id')]) {
			await assert.rejects(
				read(),
				(error: unknown) =>
					error instanceof ProviderError && error.code === 'resend_receiving_lookup_failed'
			);
		}
	});

	test('Resend is asked once per provider, however many domains are read', async () => {
		let calls = 0;
		const provider = withInbound(cloudflareLister, 'resend', 'yours.com', async () => {
			calls++;
			return resendSays(true)();
		});
		await provider.getDomain('cf-id');
		await provider.getDomain('cf-id');
		await provider.listDomains();
		assert.equal(calls, 1);
	});

	test('with inbound off no domain receives', async () => {
		const provider = withInbound(resendLike, null, 'yours.com');
		assert.equal((await provider.listDomains())[0].receivingEnabled, false);
	});

	test('the same service in both directions leaves the provider untouched', () => {
		assert.equal(withInbound(resendLike, 'resend', 'yours.com'), resendLike);
	});

	test('with outbound off, domains list as not sendable and sending is refused', async () => {
		const provider = withoutSending(resendLike);
		assert.equal((await provider.listDomains())[0].sendingEnabled, false);
		assert.equal((await provider.getDomain('resend-domain-id')).sendingEnabled, false);
		await assert.rejects(
			provider.send(providerAttachmentInput()),
			(error: unknown) => error instanceof ProviderError && error.code === 'sending_disabled'
		);
	});
});
