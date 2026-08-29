import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEmailForUser, listThreadMessages, markThreadRead } from '$lib/server/mail-store';
import { resolveReplyFromAddress } from '$lib/server/outbox';
import { displaySubject } from '$lib/server/threads';
import { listAddressesForUser } from '$lib/server/domains';
import { folderPath, mailboxViewForEmail } from '$lib/mail/folders';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const email = await getEmailForUser(platform.env.DB, locals.user.id, params.id);
	if (!email) {
		throw error(404, 'Email not found');
	}

	if (locals.uiTheme !== 'classic') {
		throw redirect(303, `${folderPath(mailboxViewForEmail(email))}?thread=${encodeURIComponent(email.id)}`);
	}

	// Opening any message opens its whole conversation.
	await markThreadRead(platform.env.DB, locals.user.id, email);
	const [messages, addresses] = await Promise.all([
		listThreadMessages(platform.env.DB, locals.user.id, email),
		listAddressesForUser(platform.env.DB, locals.user.id)
	]);
	const identities = new Map(addresses.map((address) => [address.address.toLowerCase(), address]));

	const latest = messages[messages.length - 1] ?? email;
	const replyIdentity = await resolveReplyFromAddress(platform.env.DB, locals.user, latest);

	return {
		threadId: email.thread_id ?? email.id,
		/** The message that was linked to — expanded first when the page opens. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		archived: messages.length > 0 && messages.every((message) => Boolean(message.archived_at)),
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
};
