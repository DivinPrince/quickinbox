import type { PageServerLoad } from './$types';
import { getEmailSignature } from '$lib/server/email-signature';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const signature =
		locals.user && platform?.env.DB
			? await getEmailSignature(platform.env.DB, locals.user.id)
			: '';

	return {
		domains: locals.domains,
		addresses: locals.addresses,
		signature
	};
};
