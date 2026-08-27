import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mailbox';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const view = url.searchParams.get('view') === 'archive' ? 'archive' : 'inbox';
	return loadMailbox(platform?.env.DB, locals.user?.id, view, url, locals.activeDomainId);
};
