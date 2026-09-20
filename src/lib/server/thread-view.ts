import type { D1Database } from '@cloudflare/workers-types';
import type { EmailRow, ThreadViewData, User } from '$lib/types';
import { listThreadMessages, markThreadRead } from './mail-store';
import { resolveReplyFromAddress } from './outbox';
import { displaySubject } from './threads';
import { listAddressesForUser } from './domains';

/** Call only after resolving the message with getEmailForUser. */
export async function loadThreadView(db: D1Database, user: User, email: EmailRow): Promise<ThreadViewData> {
	// Opening any message opens its whole conversation.
	await markThreadRead(db, user.id, email);
	const [messages, addresses] = await Promise.all([
		listThreadMessages(db, user.id, email),
		listAddressesForUser(db, user.id)
	]);
	const identities = new Map(addresses.map((address) => [address.address.toLowerCase(), address]));

	const latest = messages[messages.length - 1] ?? email;
	const replyIdentity = await resolveReplyFromAddress(db, user, latest);

	return {
		snoozedUntil: email.snoozed_until ?? null,
		threadId: email.thread_id ?? email.id,
		/** The message that was linked to — expanded first when the page opens. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		archived: messages.length > 0 && messages.every((message) => Boolean(message.archived_at)),
		spam: Boolean(email.spam_at),
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		replyFrom: replyIdentity?.address ?? null,
		replyFromName: replyIdentity?.label?.trim() || null,
		messages: messages.map((message) => {
			const received =
				message.direction === 'inbound'
					? identities.get(message.to_addr.trim().toLowerCase())
					: undefined;
			return {
				...message,
				is_read: true,
				received_label: received?.label?.trim() || null
			};
		})
	};
}
