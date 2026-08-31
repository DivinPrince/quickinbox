import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow, User } from '$lib/types';
import { readOutboundAttachments } from './attachments';
import type { EmailProvider } from './email-provider';
import { buildForwardedMessages, orderForwardedMessages, type ForwardNote } from './forward';
import { resolveReplyFromAddress, sendAndStore } from './outbox';
import { parseRecipients } from './send-mail';

export type ForwardRequest = {
	fromAddressId?: string;
	to?: string;
	cc?: string;
	bcc?: string;
	text?: string;
	html?: string;
	includeAttachments?: boolean;
};

export async function readForwardedAttachments(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	userId: string,
	originals: EmailRow[],
	includeAttachments = true
) {
	if (!includeAttachments) return [];
	return (
		await Promise.all(
			originals.map((message) =>
				readOutboundAttachments(env.DB, env.ATTACHMENTS, userId, message.id)
			)
		)
	).flat();
}

/** Send a new conversation containing one message or a whole ordered thread. */
export async function sendForwardedMessages(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	provider: EmailProvider,
	user: User,
	originals: EmailRow[],
	input: ForwardRequest
): Promise<{ emailId: string }> {
	if (originals.length === 0) throw new Error('No messages to forward');
	if (parseRecipients(input.to).length === 0) throw new Error('A recipient is required');
	const ordered = orderForwardedMessages(originals);

	const note: ForwardNote = { text: input.text, html: input.html };
	const { subject, text, html } = buildForwardedMessages(ordered, { note });
	const identityTarget = ordered[ordered.length - 1];
	const fromAddress = input.fromAddressId
		? undefined
		: await resolveReplyFromAddress(env.DB, user, identityTarget);

	const attachments = await readForwardedAttachments(
		env,
		user.id,
		ordered,
		input.includeAttachments !== false
	);

	// Omitting reply headers and replyToEmailId is deliberate: a forward starts
	// a new conversation. Providers set Reply-To to the selected From identity.
	const { emailId } = await sendAndStore(env, provider, user, {
		fromAddressId: input.fromAddressId,
		fromAddress,
		to: input.to!,
		cc: input.cc,
		bcc: input.bcc,
		subject,
		text,
		html,
		attachments,
		allowCombinedAttachments: ordered.length > 1,
		subjectMatch: false
	});

	return { emailId };
}
