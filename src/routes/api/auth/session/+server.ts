import { json, type RequestHandler } from '@sveltejs/kit';
import { revokeSession, SESSION_COOKIE } from '$lib/server/auth';

/** Revoke the session credential used for this request. */
export const DELETE: RequestHandler = async ({ cookies, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (!locals.user || !locals.currentSessionId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Revocation is deliberately idempotent for an authenticated request: a
	// session disappearing between authentication and this delete is still done.
	await revokeSession(db, locals.user.id, locals.currentSessionId);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	return json({ ok: true });
};
