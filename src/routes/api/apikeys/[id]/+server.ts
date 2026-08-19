import { json, type RequestHandler } from '@sveltejs/kit';
import { listApiTokens, revokeApiToken } from '$lib/server/api-tokens';

export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const removed = await revokeApiToken(db, locals.user.id, params.id!);
	if (!removed) {
		return json({ error: 'Token not found' }, { status: 404 });
	}

	return json({ ok: true, tokens: await listApiTokens(db, locals.user.id) });
};
