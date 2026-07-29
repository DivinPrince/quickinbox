import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		domains: locals.domains,
		addresses: locals.addresses
	};
};
