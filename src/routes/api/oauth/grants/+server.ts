import { json, type RequestHandler } from '@sveltejs/kit';
import { listConnectedApps, revokeClientForUser } from '$lib/server/oauth';

/** Connected MCP apps for the Settings page. Browser sessions only. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ apps: await listConnectedApps(db, locals.user.id) });
};

/** Disconnect an app: revokes every token this user issued to it. */
export const DELETE: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const clientId = url.searchParams.get('client_id');
	if (!clientId) return json({ error: 'client_id is required' }, { status: 400 });

	await revokeClientForUser(db, locals.user.id, clientId);
	return json({ ok: true, apps: await listConnectedApps(db, locals.user.id) });
};
