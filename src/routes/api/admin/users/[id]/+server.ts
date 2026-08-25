import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteUser, setUserAdmin, setUserPassword } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as { password?: unknown; isAdmin?: unknown };
	const hasPassword = body.password !== undefined;
	const hasRole = body.isAdmin !== undefined;

	if (!hasPassword && !hasRole) {
		return json({ error: 'Nothing to update' }, { status: 400 });
	}

	if (hasRole && typeof body.isAdmin !== 'boolean') {
		return json({ error: 'isAdmin must be a boolean' }, { status: 400 });
	}

	if (hasPassword && (typeof body.password !== 'string' || !body.password)) {
		return json({ error: 'Password is required' }, { status: 400 });
	}

	try {
		if (hasRole) {
			await setUserAdmin(db, locals.user, params.id!, body.isAdmin as boolean);
		}

		if (hasPassword) {
			await setUserPassword(db, params.id!, body.password as string);
		}

		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to update user' },
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
		await deleteUser(db, platform?.env.ATTACHMENTS, locals.user, params.id!);
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to delete user' },
			{ status: 400 }
		);
	}
};
