import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers } from '$lib/server/auth';
import {
	safeEmailProviderKind,
	listAvailableDomains,
	providerLoadError
} from '$lib/server/context';
import { listAllAddresses, listUnroutedEmails } from '$lib/server/domains';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		throw error(403, 'Forbidden');
	}

	const providerKind = safeEmailProviderKind(platform);
	const db = platform?.env.DB;
	if (!db) {
		return {
			users: [],
			addresses: [],
			domains: locals.domains,
			available: [],
			unrouted: [],
			providerKind,
			loadError: 'Database unavailable'
		};
	}

	const [users, addresses, unrouted] = await Promise.all([
		listUsers(db),
		listAllAddresses(db),
		listUnroutedEmails(db, 25)
	]);

	try {
		const available = await listAvailableDomains(
			platform,
			locals.domains.map((domain) => domain.id)
		);

		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available,
			providerKind,
			loadError: null
		};
	} catch (err) {
		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available: [],
			providerKind,
			loadError: providerLoadError(providerKind, err)
		};
	}
};
