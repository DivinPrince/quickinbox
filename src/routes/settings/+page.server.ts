import type { PageServerLoad } from './$types';
import { listApiTokens } from '$lib/server/api-tokens';
import { getEmailSignature } from '$lib/server/email-signature';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const signature = locals.user && db ? await getEmailSignature(db, locals.user.id) : '';
	const apiTokens = locals.user && db ? await listApiTokens(db, locals.user.id) : [];

	return {
		domains: locals.domains,
		addresses: locals.addresses,
		signature,
		apiTokens,
		isAdmin: locals.user?.is_admin ?? false
	};
};
