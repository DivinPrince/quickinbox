import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { parseEmailAddress } from '$lib/server/email-address';
import { getEmailForUser, listThreadMessages, markThreadRead } from '$lib/server/mail-store';
import { displaySubject } from '$lib/server/threads';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const email = await getEmailForUser(platform.env.DB, locals.user.id, params.id);
	if (!email) {
		throw error(404, 'Email not found');
	}

	// Opening any message opens its whole conversation.
	await markThreadRead(platform.env.DB, locals.user.id, email);
	const messages = await listThreadMessages(platform.env.DB, locals.user.id, email);

	const latest = messages[messages.length - 1] ?? email;
	const replyFrom = parseEmailAddress(
		latest.direction === 'inbound' ? latest.to_addr : latest.from_addr
	);
	const replyFromName =
		locals.addresses.find((address) => address.address.toLowerCase() === replyFrom)?.label ??
		null;

	return {
		threadId: email.thread_id ?? email.id,
		/** The message that was linked to — expanded first when the page opens. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		replyFrom,
		replyFromName,
		messages: messages.map((message) => ({ ...message, is_read: true }))
	};
};
