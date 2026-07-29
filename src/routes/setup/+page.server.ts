import type { PageServerLoad } from './$types';
import { ConfigError, getResendClient } from '$lib/server/context';
import { isDomainReceivable, isDomainSendable, ResendError } from '$lib/server/resend';
import type { AvailableDomain } from '$lib/types';

/**
 * Loads the domains this Resend key can reach so the first screen is a domain
 * choice rather than a form. Only reachable while the app has no users — the
 * hook redirects away once setup is done.
 */
export const load: PageServerLoad = async ({ platform }) => {
	try {
		const client = getResendClient(platform);
		const remote = await client.listDomains();

		const available: AvailableDomain[] = remote.map((domain) => ({
			id: domain.id,
			name: domain.name,
			status: domain.status,
			region: domain.region ?? null,
			can_send: isDomainSendable(domain),
			can_receive: isDomainReceivable(domain),
			connected: false
		}));

		return { available, resendConfigured: true, loadError: null };
	} catch (error) {
		return {
			available: [] as AvailableDomain[],
			resendConfigured: !(error instanceof ConfigError),
			loadError:
				error instanceof ConfigError || error instanceof ResendError
					? error.message
					: 'Could not reach Resend. Check the API key and try again.'
		};
	}
};
