import type { LayoutServerLoad } from './$types';
import { listApiTokens } from '$lib/server/api-tokens';
import { getEmailSignature } from '$lib/server/email-signature';
import { listDeviceSessions } from '$lib/server/auth';
import { listConnectedApps } from '$lib/server/oauth';
import { readVapidConfiguration } from '$lib/server/push-notifications';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const [signature, apiTokens, devices, connectedApps] = await Promise.all([
		locals.user && db ? getEmailSignature(db, locals.user.id) : '',
		locals.user && db ? listApiTokens(db, locals.user.id) : [],
		locals.user && db ? listDeviceSessions(db, locals.user.id, locals.currentSessionId) : [],
		locals.user && db ? listConnectedApps(db, locals.user.id) : []
	]);
	const vapid = platform?.env ? readVapidConfiguration(platform.env) : null;

	return {
		domains: locals.domains,
		addresses: locals.addresses,
		signature,
		apiTokens,
		push: {
			configured: Boolean(vapid),
			publicKey: vapid?.publicKey ?? null
		},
		isAdmin: locals.user?.is_admin ?? false,
		devices,
		connectedApps
	};
};
