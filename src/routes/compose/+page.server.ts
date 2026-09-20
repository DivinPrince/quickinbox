import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readSavedDraft } from '$lib/server/drafts';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (locals.uiTheme !== 'classic') {
		const dest = new URL('/inbox', url.origin);
		dest.searchParams.set('compose', '1');
		const draft = url.searchParams.get('draft');
		if (draft) dest.searchParams.set('draft', draft);
		const to = url.searchParams.get('to');
		if (to) dest.searchParams.set('to', to.slice(0, 1000));
		throw redirect(303, `${dest.pathname}?${dest.searchParams.toString()}`);
	}

	const draftId = url.searchParams.get('draft');
	const db = platform?.env.DB;

	const draft =
		draftId && db && locals.user ? await readSavedDraft(platform!.env, locals.user.id, draftId) : null;
	if (draftId && !draft) throw error(404, 'Draft not found');

	return { addresses: locals.addresses, draft, initialTo: (url.searchParams.get('to') || '').slice(0, 1000) };
};
