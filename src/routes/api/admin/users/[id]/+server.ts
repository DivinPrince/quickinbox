import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteUser, setUserPassword } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as { password?: string };
	if (!body.password) {
		return json({ error: 'Password is required' }, { status: 400 });
	}

	try {
		await setUserPassword(db, params.id!, body.password);
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to reset password' },
			{ status: 400 }
		);
	}
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	try {
		await deleteUser(db, locals.user, params.id!);
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to delete user' },
			{ status: 400 }
		);
	}
};
