import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDraft } from '$lib/server/mail-store';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (locals.uiTheme !== 'classic') {
		const dest = new URL('/inbox', url.origin);
		dest.searchParams.set('compose', '1');
		const draft = url.searchParams.get('draft');
		if (draft) dest.searchParams.set('draft', draft);
		throw redirect(303, `${dest.pathname}?${dest.searchParams.toString()}`);
	}

	const draftId = url.searchParams.get('draft');
	const db = platform?.env.DB;

	const draft =
		draftId && db && locals.user ? await getDraft(db, locals.user.id, draftId) : null;

	return { addresses: locals.addresses, draft };
};
