import { json, type RequestHandler } from '@sveltejs/kit';
import { revokeSession } from '$lib/server/auth';

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!params.id) return json({ error: 'Device id is required' }, { status: 400 });

	const revoked = await revokeSession(db, locals.user.id, params.id);
	if (!revoked) return json({ error: 'Device not found' }, { status: 404 });

	return json({ ok: true });
};
