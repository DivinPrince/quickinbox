import { json, type RequestHandler } from '@sveltejs/kit';
import { readSessionToken, sessionCookieOptions, SESSION_COOKIE } from '$lib/server/auth';
import { readLinkedTokens, resolveLinkedSessions, writeLinkedTokens } from '$lib/server/accounts';
import { SESSION_DAYS } from '$lib/server/constants';

/**
 * Make another signed-in account the active one. The current session is parked
 * (not revoked) so switching back is instant; the target must already hold a
 * valid session in this browser — this never grants access on its own.
 */
export const POST: RequestHandler = async ({ request, cookies, locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (locals.authMethod !== 'session' || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
	const userId = typeof body?.userId === 'string' ? body.userId : '';
	if (!userId) return json({ error: 'userId is required' }, { status: 400 });

	if (userId === locals.user.id) {
		return json({ user: locals.user, next: '/inbox' });
	}

	const activeToken = readSessionToken(cookies);
	const parked = await resolveLinkedSessions(
		db,
		readLinkedTokens(cookies).filter((token) => token !== activeToken)
	);
	const target = parked.find((session) => session.user.id === userId);
	if (!target) {
		return json({ error: 'That account is no longer signed in here' }, { status: 404 });
	}

	const others = parked.filter((session) => session !== target).map((session) => session.token);
	if (activeToken) others.unshift(activeToken);

	cookies.set(SESSION_COOKIE, target.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60, url));
	writeLinkedTokens(cookies, others, url);

	return json({
		user: target.user,
		next: target.user.must_change_password ? '/account/setup' : '/inbox'
	});
};
