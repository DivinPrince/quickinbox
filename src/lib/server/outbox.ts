import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MailAddress, OutboundAttachmentInput, User } from '$lib/types';
import { appendEmailSignature, pickEmailSignature } from '$lib/email-signature';
import { base64ByteLength } from './attachments';
import {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS_PER_EMAIL,
	MAX_TOTAL_ATTACHMENT_BYTES
} from './constants';
import {
	getAddressForUser,
	getDefaultAddress,
	getDomainByName,
	listAddressesForUser
} from './domains';
import { parseEmailAddress } from './email-address';
import { getEmailSignature } from './email-signature';
import { stripHtml } from './html';
import { MAX_BODY_BYTES } from './constants';
import { deliverOutboxJob, enqueueOutbound, getOutboxJob, type OutboxState } from './durable-outbox';
import type { EmailProvider } from './email-provider';
import { escapeHtml, parseRecipients, prepareOutboundEmail } from './send-mail';

export type ComposeInput = {
	idempotencyKey?: string;
	fromAddressId?: string | null;
	/** Pre-resolved identity — used by replies so we can send from the received mailbox. */
	fromAddress?: MailAddress | null;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	text?: string | null;
	html?: string | null;
	inReplyTo?: string | null;
	references?: string | null;
	replyToEmailId?: string | null;
	attachments?: OutboundAttachmentInput[];
	/** Forward-all can legitimately combine the per-message attachment sets. */
	allowCombinedAttachments?: boolean;
	/** Disable subject fallback for messages that intentionally start a thread. */
	subjectMatch?: boolean;
};

export function assertTotalAttachmentBytes(totalBytes: number): void {
	if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
		throw new Error('Attachments exceed the total size limit');
	}
}

/** Reject attachment sets before provider delivery or Sent-folder persistence. */
export function assertOutboundAttachments(
	attachments: OutboundAttachmentInput[],
	allowCombinedAttachments = false
): void {
	if (!allowCombinedAttachments && attachments.length > MAX_ATTACHMENTS_PER_EMAIL) {
		throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_EMAIL} attachments allowed`);
	}

	for (const attachment of attachments) {
		const bytes = base64ByteLength(attachment.content);
		if (bytes > MAX_ATTACHMENT_BYTES) {
			const limitMb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
			throw new Error(`"${attachment.filename}" exceeds ${limitMb}MB limit`);
		}
	}

	assertTotalAttachmentBytes(
		attachments.reduce((sum, attachment) => sum + base64ByteLength(attachment.content), 0)
	);
}

/**
 * Pick the identity a message is sent from: the one the composer chose, or the
 * user's default. Only addresses the user actually owns are accepted.
 */
export async function resolveFromAddress(
	db: D1Database,
	user: User,
	addressId?: string | null
): Promise<MailAddress> {
	const address = addressId
		? await getAddressForUser(db, user.id, addressId)
		: await getDefaultAddress(db, user.id);

	if (!address) {
		throw new Error('No sending address configured. Add one in Settings first.');
	}

	return address;
}

/**
 * Replies come from the mailbox that received the original, not the default
 * sending identity. Catch-all mail uses that exact recipient if the user owns
 * the domain, even when the local-part is not a saved address.
 *
 * Returns null when the user has no sending identity, so the thread page can
 * still load.
 */
/**
 * Catch-all replies send from an address that has no `addresses` row, so the id
 * below is synthetic. `emails.address_id` has a foreign key onto `addresses`,
 * so it must be stored as NULL — the address itself is still kept in `from_addr`.
 */
const SYNTHETIC_ADDRESS_ID_PREFIX = 'reply:';

export function persistableAddressId(id: string | null | undefined): string | null {
	if (!id || id.startsWith(SYNTHETIC_ADDRESS_ID_PREFIX)) return null;
	return id;
}

export async function resolveReplyFromAddress(
	db: D1Database,
	user: User,
	original: { direction: 'inbound' | 'outbound'; to_addr: string; from_addr: string }
): Promise<MailAddress | null> {
	const mailbox = parseEmailAddress(
		original.direction === 'inbound' ? original.to_addr : original.from_addr
	);

	const owned = await listAddressesForUser(db, user.id);
	const exact = owned.find((address) => address.address.toLowerCase() === mailbox);
	if (exact) return exact;

	const domainName = mailbox.split('@')[1];
	const domain = domainName ? await getDomainByName(db, domainName) : null;
	const canSendOnDomain =
		domain &&
		(domain.catchall_user_id === user.id ||
			owned.some((address) => address.domain_id === domain.id));

	if (domain && canSendOnDomain && mailbox.includes('@')) {
		return {
			id: `reply:${mailbox}`,
			user_id: user.id,
			domain_id: domain.id,
			domain_name: domain.name,
			address: mailbox,
			label: null,
			signature: null,
			is_default: false,
			created_at: new Date().toISOString()
		};
	}

	return getDefaultAddress(db, user.id);
}

/** Persist the complete message before attempting provider delivery. */
export async function sendAndStore(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	provider: EmailProvider,
	user: User,
	input: ComposeInput
): Promise<{ emailId: string; providerId: string | null; from: MailAddress; state: OutboxState }> {
	// resolveFromAddress scopes the lookup to this user, so ownership is implied.
	const from = input.fromAddress ?? (await resolveFromAddress(env.DB, user, input.fromAddressId));

	const bodyHtml = input.html?.trim() || null;
	const bodyText = input.text?.trim() || (bodyHtml ? stripHtml(bodyHtml) : '');

	// The automatic signature does not count as message content.
	if (!bodyText && !bodyHtml) {
		throw new Error('Message body is required');
	}

	const { text, html } = appendEmailSignature({
		text: bodyText,
		html: bodyHtml,
		signature: pickEmailSignature(from.signature, await getEmailSignature(env.DB, user.id))
	});

	const attachments = input.attachments ?? [];
	assertOutboundAttachments(attachments, input.allowCombinedAttachments);

	const outbound = prepareOutboundEmail({
		from,
		senderName: from.label?.trim() || user.name,
		to: input.to,
		cc: input.cc ?? undefined,
		bcc: input.bcc ?? undefined,
		subject: input.subject,
		text,
		html: html ?? undefined,
		inReplyTo: input.inReplyTo,
		references: input.references,
		attachments
	});

	const storedHtml = html ?? escapeHtml(text).replaceAll('\n', '<br>\n');
	if ([text, storedHtml].some((body) => new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)) {
		throw new Error('Message body exceeds the storage limit');
	}
	const job = await enqueueOutbound(env, provider.kind, outbound, {
		userId: user.id,
		direction: 'outbound',
		from: from.address,
		fromName: from.label?.trim() || user.name,
		to: parseRecipients(input.to).join(', '),
		cc: parseRecipients(input.cc).join(', ') || null,
		bcc: parseRecipients(input.bcc).join(', ') || null,
		subject: input.subject.trim(),
		bodyText: text,
		bodyHtml: storedHtml,
		inReplyTo: input.inReplyTo ?? null,
		references: input.references ?? null,
		replyToEmailId: input.replyToEmailId ?? null,
		domainId: from.domain_id,
		addressId: persistableAddressId(from.id),
		isRead: true,
		subjectMatch: input.subjectMatch
	}, input.idempotencyKey);

	try {
		await deliverOutboxJob(env, provider, job.id);
	} catch {
		// The durable job remains recoverable even when the request loses storage
		// connectivity after the provider accepted the message.
		console.error('Outbox delivery needs recovery', job.id);
	}
	let current = job;
	try { current = (await getOutboxJob(env.DB, job.id)) ?? job; } catch { /* scheduled recovery */ }
	return { emailId: job.id, providerId: current.provider_id, from, state: current.state };
}
