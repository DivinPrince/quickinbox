import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow, MailAddress, OutboundAttachmentInput, User } from '$lib/types';
import { appendEmailSignature, pickEmailSignature } from '$lib/email-signature';
import { base64ByteLength, insertAttachments } from './attachments';
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
import { parseEmailAddress, parseEmailAddresses } from './email-address';
import { getEmailSignature } from './email-signature';
import { stripHtml } from './html';
import { insertEmail, listThreadMessages } from './mail-store';
import { initialOutboundStatus, ProviderError, type EmailProvider } from './email-provider';
import {
	claimSendAttempt,
	completeSendAttempt,
	failSendAttempt,
	markSendUncertain,
	recordProviderAccepted,
	sha256Hex
} from './send-attempts';
import {
	claimDailySend,
	refundDailySend,
	SendPolicyError,
	utcDay,
	type ApiSendPolicy
} from './send-policy';
import { escapeHtml, parseRecipients, sendOutboundEmail, validateSubject } from './send-mail';

export type ComposeInput = {
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
	/** Retries with the same key return the first result instead of sending again. */
	idempotencyKey?: string | null;
	/** Set when an API key or OAuth token is sending, never for a browser session. */
	apiPolicy?: ApiSendPolicy;
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

/** Who a reply goes to: the sender, or — replying to our own message — its recipients. */
export function replyTarget(message: Pick<EmailRow, 'direction' | 'from_addr' | 'to_addr'>): string[] {
	return parseEmailAddresses(message.direction === 'inbound' ? message.from_addr : message.to_addr);
}

export type ReplyGuardErrorCode = 'conversation_advanced' | 'recipient_changed';

export class ReplyGuardError extends Error {
	readonly status = 409;

	constructor(
		readonly code: ReplyGuardErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ReplyGuardError';
	}
}

function sameAddresses(left: string[], right: string[]): boolean {
	const normalize = (values: string[]) =>
		[...new Set(values.map((value) => parseEmailAddress(value)).filter(Boolean))].sort();
	const a = normalize(left);
	const b = normalize(right);
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * An agent replies from what it last read. Refuse when that is stale: the
 * conversation has moved past the message it is answering — a new message from
 * them, or a reply someone else sent meanwhile — or the reply would reach
 * someone other than the recipients it reviewed.
 */
export async function assertReplyReviewed(
	db: D1Database,
	userId: string,
	original: EmailRow,
	recipients: string[],
	expectedRecipients: string[]
): Promise<void> {
	const messages = await listThreadMessages(db, userId, original);
	const index = messages.findIndex((message) => message.id === original.id);
	if (index >= 0 && index < messages.length - 1) {
		throw new ReplyGuardError(
			'conversation_advanced',
			'This conversation has a newer message than the one you are replying to. Read it again and reply to the latest message.'
		);
	}
	if (!sameAddresses(recipients, expectedRecipients)) {
		throw new ReplyGuardError(
			'recipient_changed',
			`This reply would go to ${recipients.join(', ') || 'nobody'}, not the expected recipients. Read the conversation again before replying.`
		);
	}
}

/** What the recipient would receive — a reused Idempotency-Key must match it. */
async function composeFingerprint(from: MailAddress, input: ComposeInput): Promise<string> {
	// Each attachment is hashed on its own: joining up to 25 MB of base64 into
	// one string, then encoding it, would hold several copies in memory at once.
	const attachments: string[][] = [];
	for (const attachment of input.attachments ?? []) {
		attachments.push([
			attachment.filename,
			attachment.type,
			attachment.disposition ?? '',
			attachment.contentId ?? '',
			await sha256Hex(attachment.content)
		]);
	}
	return sha256Hex(
		JSON.stringify({
			from: from.address,
			to: parseRecipients(input.to),
			cc: parseRecipients(input.cc),
			bcc: parseRecipients(input.bcc),
			subject: input.subject.trim(),
			text: input.text?.trim() ?? '',
			html: input.html?.trim() ?? '',
			inReplyTo: input.inReplyTo ?? null,
			attachments
		})
	);
}

/**
 * Whether the provider refused the message, so it certainly was not sent.
 * Lost responses, timeouts and server errors are ambiguous: it may be out.
 * Cloudflare binding errors that carry no code (`send_failed`) count as ambiguous.
 */
export function providerRefused(error: unknown): boolean {
	if (!(error instanceof ProviderError)) return false;
	if (error.code === 'E_RATE_LIMIT_EXCEEDED') return true;
	return error.status >= 400 && error.status < 500 && error.code !== 'send_failed';
}

/** Send through the configured provider, then record it in the Sent folder. */
export async function sendAndStore(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	provider: EmailProvider,
	user: User,
	input: ComposeInput
): Promise<{ emailId: string; providerId: string; from: MailAddress }> {
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

	if (input.apiPolicy && !input.apiPolicy.enabled) {
		throw new SendPolicyError(
			'api_sending_disabled',
			403,
			'Sending with API keys and MCP is turned off on this server'
		);
	}

	// Checked before an attempt is claimed, so a typo never locks its key.
	const subjectError = validateSubject(input.subject);
	if (subjectError) throw new Error(subjectError);
	if (parseRecipients(input.to).length === 0) {
		throw new Error('At least one valid recipient is required');
	}

	const fingerprint = input.idempotencyKey ? await composeFingerprint(from, input) : '';
	const attempt = input.idempotencyKey
		? await claimSendAttempt(env.DB, user.id, input.idempotencyKey, fingerprint)
		: null;
	if (attempt?.kind === 'replay') {
		return { emailId: attempt.emailId, providerId: attempt.providerId, from };
	}

	const dailyLimit = input.apiPolicy?.dailyLimit;
	// Set once a slot is taken, so a refused send can give it back.
	let budgetDay: string | null = null;
	// Anything that fails before the provider is called certainly sent nothing.
	let providerCalled = false;
	let providerId: string;
	try {
		// Counted after the replay check: a retry that sends nothing costs nothing.
		if (dailyLimit) {
			const day = utcDay();
			if (!(await claimDailySend(env.DB, user.id, dailyLimit, day))) {
				throw new SendPolicyError(
					'daily_send_limit',
					429,
					`This account has reached its limit of ${dailyLimit} API sends today (UTC). Try again tomorrow.`
				);
			}
			budgetDay = day;
		}
		providerCalled = true;
		({ providerId } = await sendOutboundEmail(provider, {
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
			attachments,
			// Resend dedupes on this too, which covers a timeout that hid a send. The
			// content is part of it: a failed send retried after an edit is new mail.
			...(attempt ? { idempotencyKey: `${attempt.id}:${fingerprint}` } : {})
		}));
	} catch (error) {
		// Only a refusal proves nothing went out; an ambiguous failure keeps its slot.
		if (budgetDay && providerRefused(error)) {
			await refundDailySend(env.DB, user.id, budgetDay).catch((failure) =>
				console.error('Failed to give back a refused send', user.id, failure)
			);
		}
		if (attempt) {
			const notSent =
				!providerCalled || error instanceof SendPolicyError || providerRefused(error);
			const record = notSent ? failSendAttempt : markSendUncertain;
			await record(env.DB, attempt.id, error).catch((failure) =>
				console.error('Failed to record the failed send attempt', attempt.id, failure)
			);
		}
		throw error;
	}

	// The mail is out. If even noting that fails, leave the attempt as "outcome
	// unknown" rather than "still sending", so no retry waits on it forever.
	if (attempt) {
		await recordProviderAccepted(env.DB, attempt.id, providerId).catch(async (failure) => {
			console.error('Failed to record the accepted send', attempt.id, failure);
			await markSendUncertain(env.DB, attempt.id, failure).catch(() => {});
		});
	}

	const emailId = await insertEmail(env.DB, {
		userId: user.id,
		direction: 'outbound',
		from: from.address,
		fromName: from.label?.trim() || user.name,
		to: parseRecipients(input.to).join(', '),
		cc: parseRecipients(input.cc).join(', ') || null,
		bcc: parseRecipients(input.bcc).join(', ') || null,
		subject: input.subject.trim(),
		bodyText: text,
		bodyHtml: html ?? escapeHtml(text).replaceAll('\n', '<br>\n'),
		inReplyTo: input.inReplyTo ?? null,
		references: input.references ?? null,
		replyToEmailId: input.replyToEmailId ?? null,
		domainId: from.domain_id,
		addressId: persistableAddressId(from.id),
		providerId,
		status: initialOutboundStatus(provider.kind),
		isRead: true,
		subjectMatch: input.subjectMatch
	});

	if (attachments.length > 0) {
		await insertAttachments(env.DB, env.ATTACHMENTS, emailId, attachments, {
			enforceCountLimit: !input.allowCombinedAttachments
		});
	}

	if (attempt) await completeSendAttempt(env.DB, attempt.id, emailId, providerId);

	return { emailId, providerId, from };
}
