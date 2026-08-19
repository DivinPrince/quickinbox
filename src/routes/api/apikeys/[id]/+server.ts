import { json, type RequestHandler } from '@sveltejs/kit';
import { listApiTokens, revokeApiToken } from '$lib/server/api-tokens';

export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Belt and braces: the hook already keeps bearer tokens off this route, but a
	// key must never be able to mint or revoke keys even if that list changes.
	if (locals.apiToken) {
		return json({ error: 'Key management requires a signed-in session' }, { status: 403 });
	}

	const removed = await revokeApiToken(db, locals.user.id, params.id!);
	if (!removed) {
		return json({ error: 'Token not found' }, { status: 404 });
	}

	return json({ ok: true, tokens: await listApiTokens(db, locals.user.id) });
};