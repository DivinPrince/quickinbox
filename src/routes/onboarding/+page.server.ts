import type { PageServerLoad } from './$types';
import { ConfigError, getResendClient } from '$lib/server/context';
import { isDomainReceivable, isDomainSendable, ResendError } from '$lib/server/resend';

export type AvailableDomain = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	can_send: boolean;
	can_receive: boolean;
	connected: boolean;
};

export const load: PageServerLoad = async ({ locals, platform }) => {
	const base = {
		domains: locals.domains,
		addresses: locals.addresses,
		isAdmin: locals.user?.is_admin ?? false
	};

	// Only the admin talks to Resend; everyone else just claims an address on an
	// already-connected domain.
	if (!locals.user?.is_admin) {
		return { ...base, available: [] as AvailableDomain[], resendConfigured: true, loadError: null };
	}

	try {
		const client = getResendClient(platform);
		const remote = await client.listDomains();
		const connectedIds = new Set(locals.domains.map((domain) => domain.id));

		const available: AvailableDomain[] = remote.map((domain) => ({
			id: domain.id,
			name: domain.name,
			status: domain.status,
			region: domain.region ?? null,
			can_send: isDomainSendable(domain),
			can_receive: isDomainReceivable(domain),
			connected: connectedIds.has(domain.id)
		}));

		return { ...base, available, resendConfigured: true, loadError: null };
	} catch (error) {
		return {
			...base,
			available: [] as AvailableDomain[],
			resendConfigured: !(error instanceof ConfigError),
			loadError:
				error instanceof ConfigError || error instanceof ResendError
					? error.message
					: 'Could not reach Resend. Check the API key and try again.'
		};
	}
};
