import type { R2Bucket } from '@cloudflare/workers-types';
import PostalMime, { type Address, type Attachment } from 'postal-mime';
import { insertAttachmentBytes } from './attachments';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from './constants';
import { recordUnroutedEmail, resolveInboundRoute } from './domains';
import { collectInboundRecipients, parseEmailAddress } from './email-address';
import { emailExistsByProviderId, insertEmail } from './mail-store';
import { scheduleNewMailNotification, type PushNotificationEnv } from './push-notifications';
import { normalizeMessageId } from './send-mail';

export type CloudflareInboundMessage = {
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream<Uint8Array>;
	setReject(reason: string): void;
};

export type CloudflareInboundEnv = PushNotificationEnv & {
	ATTACHMENTS: R2Bucket;
};

/**
 * Email Routing delivers the full MIME on `message.raw`. Parse once, then reuse
 * the same mailbox routing and D1/R2 store as the Resend webhook path.
 */
export async function handleCloudflareInbound(
	message: CloudflareInboundMessage,
	env: CloudflareInboundEnv
): Promise<void> {
	const raw = await new Response(message.raw).arrayBuffer();
	const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });

	const envelopeTo = parseEmailAddress(message.to);
	const recipients = collectInboundRecipients({
		received_for: envelopeTo.includes('@') ? [envelopeTo] : [],
		to: mailboxAddresses(parsed.to),
		cc: mailboxAddresses(parsed.cc),
		bcc: mailboxAddresses(parsed.bcc)
	});

	const sender = firstMailboxIdentity(parsed.from);
	const from = inboundSender(sender?.address, message.from);
	const subject = parsed.subject?.trim() || message.headers.get('subject')?.trim() || '(no subject)';
	const messageId =
		normalizeMessageId(parsed.messageId ?? message.headers.get('message-id')) ?? null;
	const inReplyTo =
		normalizeMessageId(parsed.inReplyTo ?? message.headers.get('in-reply-to')) ?? null;
	const references = parsed.references ?? message.headers.get('references') ?? null;
	const providerId = await inboundProviderId({
		messageId,
		from,
		to: envelopeTo || recipients.join(','),
		date: parsed.date ?? message.headers.get('date')
	});

	if (await emailExistsByProviderId(env.DB, providerId)) {
		return;
	}

	const route = await resolveInboundRoute(env.DB, recipients);

	if (!route) {
		await recordUnroutedEmail(env.DB, {
			providerId,
			from,
			to: recipients.join(', ') || envelopeTo || '(unknown)',
			subject,
			reason: 'No matching address and no catch-all for this domain'
		});
		return;
	}

	const emailId = await insertEmail(env.DB, {
		userId: route.userId,
		direction: 'inbound',
		from,
		fromName: sender?.name,
		to: route.address,
		cc: mailboxAddresses(parsed.cc).join(', ') || null,
		subject,
		bodyText: parsed.text ?? null,
		bodyHtml: parsed.html ?? null,
		messageId,
		inReplyTo,
		references,
		domainId: route.domainId,
		addressId: route.addressId,
		providerId
	});

	await storeInboundAttachments(env, emailId, parsed.attachments);
	await scheduleNewMailNotification(env, {
		emailId,
		userId: route.userId,
		from: sender?.name || from,
		subject
	});
}

async function storeInboundAttachments(
	env: CloudflareInboundEnv,
	emailId: string,
	attachments: Attachment[]
): Promise<void> {
	for (const attachment of attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
		const bytes = attachmentBytes(attachment.content);
		if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
			continue;
		}

		try {
			await insertAttachmentBytes(env.DB, env.ATTACHMENTS, emailId, {
				filename: attachment.filename || 'attachment',
				type: attachment.mimeType || 'application/octet-stream',
				bytes
			});
		} catch (error) {
			console.error('Failed to store inbound Cloudflare attachment', attachment.filename, error);
		}
	}
}

/**
 * Who the mail is *from*, for display, replies and search.
 *
 * `message.from` is the envelope sender — SMTP `MAIL FROM` — which providers
 * routinely point at a bounce mailbox rather than the author. Cloudflare Email
 * Sending uses `bounces@cf-bounce.<domain>`, and VERP senders behave the same
 * way, so preferring the envelope attributes mail to the bounce address and
 * sends replies there. The `From:` header carries the author, so it wins; the
 * envelope is only a fallback for mail that arrives without a usable header.
 */
export function inboundSender(
	headerFrom: string | undefined,
	envelopeFrom: string | undefined
): string {
	// Choose on whether the header actually yielded an address, not on whether it
	// was present: a blank or malformed `From:` is still a truthy string, and
	// picking it on that alone would skip the fallback entirely.
	const header = parseEmailAddress(headerFrom ?? '');
	if (header.includes('@')) return header;

	const envelope = parseEmailAddress(envelopeFrom ?? '');
	return envelope || header;
}

function mailboxAddresses(value: Address | Address[] | undefined): string[] {
	if (!value) return [];
	const list = Array.isArray(value) ? value : [value];
	const addresses: string[] = [];

	for (const item of list) {
		if (item.address) addresses.push(item.address);
		if (item.group) {
			for (const member of item.group) {
				if (member.address) addresses.push(member.address);
			}
		}
	}

	return addresses;
}

function firstMailboxIdentity(
	value: Address | Address[] | undefined
): { name: string | null; address: string } | null {
	if (!value) return null;
	const list = Array.isArray(value) ? value : [value];

	for (const item of list) {
		if (item.address) return { name: item.name?.trim() || null, address: parseEmailAddress(item.address) };
		if (item.group) {
			for (const member of item.group) {
				if (member.address) {
					return {
						name: member.name?.trim() || null,
						address: parseEmailAddress(member.address)
					};
				}
			}
		}
	}

	return null;
}

function attachmentBytes(content: Attachment['content']): Uint8Array | null {
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (ArrayBuffer.isView(content)) {
		return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	}
	if (typeof content === 'string' && content.length > 0) {
		return new TextEncoder().encode(content);
	}
	return null;
}

async function inboundProviderId(input: {
	messageId: string | null;
	from: string;
	to: string;
	date: string | null | undefined;
}): Promise<string> {
	if (input.messageId) return input.messageId;

	const material = `${input.from}\n${input.to}\n${input.date ?? ''}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `cf-${hex.slice(0, 32)}`;
}
