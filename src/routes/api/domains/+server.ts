import { json, type RequestHandler } from '@sveltejs/kit';
import { ConfigError, getResendClient } from '$lib/server/context';
import { listDomains, syncDomains, upsertDomain } from '$lib/server/domains';
import { isDomainReceivable, isDomainSendable, ResendError } from '$lib/server/resend';

/**
 * GET  — every domain the configured Resend key can reach, flagged with
 *        whether it is already connected to this dashboard.
 * POST — connect one (or several) of them.
 */
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const connected = await listDomains(db);

	// Non-admins only need what is already wired up.
	if (!locals.user.is_admin) {
		return json({ connected, available: [], resendConfigured: true });
	}

	try {
		const client = getResendClient(platform);

		if (url.searchParams.get('sync') === '1') {
			return json({ connected: await syncDomains(db, client), available: [] });
		}

		const remote = await client.listDomains();
		const connectedIds = new Set(connected.map((domain) => domain.id));

		return json({
			connected,
			resendConfigured: true,
			available: remote.map((domain) => ({
				id: domain.id,
				name: domain.name,
				status: domain.status,
				region: domain.region,
				can_send: isDomainSendable(domain),
				can_receive: isDomainReceivable(domain),
				connected: connectedIds.has(domain.id)
			}))
		});
	} catch (error) {
		if (error instanceof ConfigError) {
			return json({ connected, available: [], resendConfigured: false, error: error.message });
		}
		return json(
			{
				connected,
				available: [],
				resendConfigured: true,
				error: error instanceof ResendError ? error.message : 'Failed to reach Resend'
			},
			{ status: error instanceof ResendError ? error.status : 502 }
		);
	}
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = (await request.json()) as { domainIds?: string[]; domainId?: string };
	const ids = body.domainIds ?? (body.domainId ? [body.domainId] : []);

	if (ids.length === 0) {
		return json({ error: 'Select at least one domain' }, { status: 400 });
	}

	try {
		const client = getResendClient(platform);
		const connected = [];

		for (const id of ids) {
			// Read it back from Resend so status/capabilities are authoritative.
			const domain = await client.getDomain(id);
			connected.push(await upsertDomain(db, domain));
		}

		return json({ connected, domains: await listDomains(db) }, { status: 201 });
	} catch (error) {
		const message =
			error instanceof ConfigError || error instanceof ResendError
				? error.message
				: 'Failed to connect domain';
		return json({ error: message }, { status: 400 });
	}
};
