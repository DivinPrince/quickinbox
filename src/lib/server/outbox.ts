import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MailAddress, OutboundAttachmentInput, User } from '$lib/types';
import { base64ByteLength, insertAttachments } from './attachments';
import { MAX_TOTAL_ATTACHMENT_BYTES } from './constants';
import { getAddressForUser, getDefaultAddress } from './domains';
import { stripHtml } from './html';
import { insertEmail } from './mail-store';
import type { ResendClient } from './resend';
import { parseRecipients, sendOutboundEmail } from './send-mail';

export type ComposeInput = {
	fromAddressId?: string | null;
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
};

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

/** Send through Resend, then record it in the Sent folder with its provider id. */
export async function sendAndStore(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	client: ResendClient,
	user: User,
	input: ComposeInput
): Promise<{ emailId: string; providerId: string; from: MailAddress }> {
	// resolveFromAddress scopes the lookup to this user, so ownership is implied.
	const from = await resolveFromAddress(env.DB, user, input.fromAddressId);

	const html = input.html?.trim() || null;
	const text = input.text?.trim() || (html ? stripHtml(html) : '');

	if (!text && !html) {
		throw new Error('Message body is required');
	}

	const attachments = input.attachments ?? [];
	const totalBytes = attachments.reduce(
		(sum, file) => sum + base64ByteLength(file.content),
		0
	);
	if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
		throw new Error('Attachments exceed the total size limit');
	}

	const { providerId } = await sendOutboundEmail(client, {
		from,
		senderName: user.name,
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

	const emailId = await insertEmail(env.DB, {
		userId: user.id,
		direction: 'outbound',
		from: from.address,
		to: parseRecipients(input.to).join(', '),
		cc: parseRecipients(input.cc).join(', ') || null,
		bcc: parseRecipients(input.bcc).join(', ') || null,
		subject: input.subject.trim(),
		bodyText: text,
		bodyHtml: html ?? text.replaceAll('\n', '<br>\n'),
		inReplyTo: input.inReplyTo ?? null,
		references: input.references ?? null,
		replyToEmailId: input.replyToEmailId ?? null,
		domainId: from.domain_id,
		providerId,
		status: 'queued',
		isRead: true
	});

	if (attachments.length > 0) {
		await insertAttachments(env.DB, env.ATTACHMENTS, emailId, attachments);
	}

	return { emailId, providerId, from };
}
