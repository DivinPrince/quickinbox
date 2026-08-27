import { json, type RequestHandler } from '@sveltejs/kit';
import {
	ConfigError,
	getEmailProvider,
	safeEmailProviderKind,
	hasProviderConfigured,
	listAvailableDomains,
	ProviderError,
	providerLoadError
} from '$lib/server/context';
import { listDomains, syncDomains, upsertDomain } from '$lib/server/domains';

/**
 * GET  — every domain the configured provider can reach, flagged with
 *        whether it is already connected to this dashboard.
 * POST — connect one (or several) of them.
 */
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const connected = await listDomains(db);
	const providerKind = safeEmailProviderKind(platform);

	// Non-admins only need what is already wired up.
	if (!locals.user.is_admin) {
		return json({
			connected,
			available: [],
			providerConfigured: true,
			providerKind
		});
	}

	try {
		const provider = getEmailProvider(platform);

		if (url.searchParams.get('sync') === '1') {
			return json({
				connected: await syncDomains(db, provider),
				available: [],
				providerKind
			});
		}

		return json({
			connected,
			providerConfigured: true,
			providerKind,
			available: await listAvailableDomains(
				platform,
				connected.map((domain) => domain.id)
			)
		});
	} catch (error) {
		if (error instanceof ConfigError) {
			return json({
				connected,
				available: [],
				providerConfigured: false,
				providerKind,
				error: error.message
			});
		}
		return json(
			{
				connected,
				available: [],
				providerConfigured: hasProviderConfigured(platform),
				providerKind,
				error: providerLoadError(providerKind, error)
			},
			{ status: error instanceof ProviderError ? (error.status >= 500 ? 502 : 400) : 502 }
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
		const provider = getEmailProvider(platform);
		const connected = [];

		for (const id of ids) {
			connected.push(await upsertDomain(db, await provider.getDomain(id)));
		}

		return json({ connected, domains: await listDomains(db) }, { status: 201 });
	} catch (error) {
		const message =
			error instanceof ConfigError || error instanceof ProviderError
				? error.message
				: 'Failed to connect domain';
		return json({ error: message }, { status: 400 });
	}
};
