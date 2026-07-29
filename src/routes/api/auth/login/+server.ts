import { json, type RequestHandler } from '@sveltejs/kit';
import { login, logout, readSessionToken, sessionCookieOptions, SESSION_COOKIE } from '$lib/server/auth';
import { SESSION_DAYS } from '$lib/server/constants';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as { email?: string; password?: string };
	if (!body.email || !body.password) {
		return json({ error: 'Email and password are required' }, { status: 400 });
	}

	const result = await login(db, body.email, body.password);
	if (!result) {
		return json({ error: 'Invalid email or password' }, { status: 401 });
	}

	cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));

	return json({ user: result.user });
};

export const DELETE: RequestHandler = async ({ cookies, platform }) => {
	const db = platform?.env.DB;
	const token = readSessionToken(cookies);

	if (db && token) {
		await logout(db, token);
	}

	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
