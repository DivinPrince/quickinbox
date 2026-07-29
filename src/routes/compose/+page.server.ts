import type { PageServerLoad } from './$types';
import { getDraft } from '$lib/server/mail-store';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const draftId = url.searchParams.get('draft');
	const db = platform?.env.DB;

	const draft =
		draftId && db && locals.user ? await getDraft(db, locals.user.id, draftId) : null;

	return { addresses: locals.addresses, draft };
};
