import { json, type RequestHandler } from '@sveltejs/kit';
import { listDeviceSessions } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	return json(
		{ devices: await listDeviceSessions(db, locals.user.id, locals.currentSessionId) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
