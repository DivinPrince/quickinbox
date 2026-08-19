import type { PageServerLoad } from './$types';
import { getEmailSignature } from '$lib/server/email-signature';
import { listApiTokens } from '$lib/server/api-tokens';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const signature = locals.user && db ? await getEmailSignature(db, locals.user.id) : '';

	return {
		domains: locals.domains,
		addresses: locals.addresses,
		signature,
		apiTokens: db && locals.user ? await listApiTokens(db, locals.user.id) : []
	};
};
