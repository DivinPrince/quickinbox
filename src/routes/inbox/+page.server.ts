import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mailbox';

export const load: PageServerLoad = async ({ locals, platform, url }) =>
	loadMailbox(platform?.env.DB, locals.user?.id, 'inbox', url, locals.activeDomainId);
