import type { LayoutServerLoad } from './$types';
import { getMailboxCounts } from '$lib/server/mail-store';
import type { MailboxCounts } from '$lib/types';

const EMPTY_COUNTS: MailboxCounts = {
	inbox: 0,
	inbox_unread: 0,
	starred: 0,
	drafts: 0,
	sent: 0,
	trash: 0
};

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;

	// The sidebar shows these on every page, so they load with the shell.
	const counts =
		db && locals.user
			? await getMailboxCounts(db, locals.user.id, locals.activeDomainId)
			: EMPTY_COUNTS;

	return {
		user: locals.user,
		domains: locals.domains,
		addresses: locals.addresses,
		activeDomainId: locals.activeDomainId,
		counts
	};
};
