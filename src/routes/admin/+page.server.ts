import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers } from '$lib/server/auth';
import { ConfigError, getResendClient } from '$lib/server/context';
import { listAllAddresses, listUnroutedEmails } from '$lib/server/domains';
import { isDomainReceivable, isDomainSendable, ResendError } from '$lib/server/resend';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		throw error(403, 'Forbidden');
	}

	const db = platform?.env.DB;
	if (!db) {
		return {
			users: [],
			addresses: [],
			domains: locals.domains,
			available: [],
			unrouted: [],
			loadError: 'Database unavailable'
		};
	}

	const [users, addresses, unrouted] = await Promise.all([
		listUsers(db),
		listAllAddresses(db),
		listUnroutedEmails(db, 25)
	]);

	const connectedIds = new Set(locals.domains.map((domain) => domain.id));

	try {
		const client = getResendClient(platform);
		const remote = await client.listDomains();

		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available: remote.map((domain) => ({
				id: domain.id,
				name: domain.name,
				status: domain.status,
				region: domain.region ?? null,
				can_send: isDomainSendable(domain),
				can_receive: isDomainReceivable(domain),
				connected: connectedIds.has(domain.id)
			})),
			loadError: null
		};
	} catch (err) {
		return {
			users,
			addresses,
			unrouted,
			domains: locals.domains,
			available: [],
			loadError:
				err instanceof ConfigError || err instanceof ResendError
					? err.message
					: 'Could not reach Resend'
		};
	}
};
