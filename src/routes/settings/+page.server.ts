import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		domains: locals.domains,
		addresses: locals.addresses,
		user: locals.user
			? {
					name: locals.user.name,
					email: locals.user.email,
					hasAvatar: Boolean(locals.user.avatar_key),
					externalAvatars: locals.user.external_avatars
				}
			: null
	};
};
