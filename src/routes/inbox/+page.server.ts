import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mailbox';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (url.searchParams.get('view') === 'archive' && locals.uiTheme !== 'classic') {
		const next = new URL(url);
		next.pathname = '/archive';
		next.searchParams.delete('view');
		throw redirect(303, `${next.pathname}${next.search}`);
	}
	const view = url.searchParams.get('view') === 'archive' ? 'archive' : 'inbox';
	return loadMailbox(platform?.env.DB, locals.user?.id, view, url, locals.activeDomainId);
};
