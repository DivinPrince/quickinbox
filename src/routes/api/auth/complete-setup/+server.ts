import { json, type RequestHandler } from '@sveltejs/kit';
import { completeFirstLogin, SESSION_COOKIE } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!locals.user.must_change_password) {
		return json({ error: 'Account setup is already complete' }, { status: 400 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as {
		name?: unknown;
		password?: unknown;
		confirmPassword?: unknown;
	};
	if (typeof body.name !== 'string' || !body.name.trim()) {
		return json({ error: 'Name is required' }, { status: 400 });
	}
	if (body.name.trim().length > 128) {
		return json({ error: 'Name must be 128 characters or fewer' }, { status: 400 });
	}
	if (
		typeof body.password !== 'string' ||
		body.password.length < 8 ||
		body.password.length > 1024
	) {
		if (typeof body.password === 'string' && body.password.length > 1024) {
			return json({ error: 'Password must be 1024 characters or fewer' }, { status: 400 });
		}
		return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
	}
	if (body.password !== body.confirmPassword) {
		return json({ error: 'Passwords do not match' }, { status: 400 });
	}

	try {
		await completeFirstLogin(db, locals.user.id, {
			name: body.name,
			password: body.password
		});
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to complete account setup' },
			{ status: 400 }
		);
	}
};
