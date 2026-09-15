import { json, type RequestHandler } from '@sveltejs/kit';
import { completeFirstLogin, SESSION_COOKIE } from '$lib/server/auth';

type SetupErrorCode =
	| 'unauthorized'
	| 'already_complete'
	| 'database_unavailable'
	| 'invalid_request'
	| 'name_required'
	| 'name_too_long'
	| 'password_too_short'
	| 'password_too_long'
	| 'password_mismatch'
	| 'password_reused'
	| 'unknown';

function setupError(code: SetupErrorCode, status: number) {
	return json({ code }, { status });
}

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return setupError('unauthorized', 401);
	}
	if (!locals.user.must_change_password) {
		return setupError('already_complete', 400);
	}

	const db = platform?.env.DB;
	if (!db) return setupError('database_unavailable', 503);

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return setupError('invalid_request', 400);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return setupError('invalid_request', 400);
	}

	const body = parsed as {
		name?: unknown;
		password?: unknown;
		confirmPassword?: unknown;
	};
	if (typeof body.name !== 'string' || !body.name.trim()) {
		return setupError('name_required', 400);
	}
	if (body.name.trim().length > 128) {
		return setupError('name_too_long', 400);
	}
	if (
		typeof body.password !== 'string' ||
		body.password.length < 8 ||
		body.password.length > 1024
	) {
		if (typeof body.password === 'string' && body.password.length > 1024) {
			return setupError('password_too_long', 400);
		}
		return setupError('password_too_short', 400);
	}
	if (body.password !== body.confirmPassword) {
		return setupError('password_mismatch', 400);
	}

	try {
		await completeFirstLogin(db, locals.user.id, {
			name: body.name,
			password: body.password
		});
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return json({ ok: true });
	} catch (error) {
		if (error instanceof Error) {
			if (error.message === 'Account setup is already complete') {
				return setupError('already_complete', 400);
			}
			if (error.message === 'Choose a password different from the temporary password') {
				return setupError('password_reused', 400);
			}
		}
		return setupError('unknown', 500);
	}
};
