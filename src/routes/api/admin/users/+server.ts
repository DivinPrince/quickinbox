import { json, type RequestHandler } from '@sveltejs/kit';
import { createUser, deletePendingUser, listUsers } from '$lib/server/auth';
import { createAddress, getDomain, listAllAddresses } from '$lib/server/domains';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const [users, addresses] = await Promise.all([listUsers(db), listAllAddresses(db)]);
	return json({ users, addresses });
};

/**
 * Creates a user and their mailbox together — the address doubles as the login,
 * so an invited user lands straight in their inbox with nothing to configure.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as {
		name?: string;
		domainId?: string;
		localPart?: string;
		password?: string;
		isAdmin?: boolean;
	};

	if (!body.name?.trim() || !body.localPart?.trim() || !body.domainId) {
		return json({ error: 'Name, address, and domain are required' }, { status: 400 });
	}

	if (!body.password || body.password.length < 8) {
		return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
	}

	const domain = await getDomain(db, body.domainId);
	if (!domain) {
		return json({ error: 'Domain is not connected' }, { status: 400 });
	}

	const localPart = body.localPart.trim().toLowerCase().replace(/@.*$/, '');

	let createdUserId: string | null = null;
	try {
		const user = await createUser(db, {
			email: `${localPart}@${domain.name}`,
			name: body.name,
			password: body.password,
			isAdmin: body.isAdmin === true,
			mustChangePassword: true
		});
		createdUserId = user.id;

		const address = await createAddress(db, {
			userId: user.id,
			domainId: domain.id,
			localPart
		});

		return json({ user, address }, { status: 201 });
	} catch (error) {
		if (createdUserId) {
			try {
				await deletePendingUser(db, createdUserId);
			} catch (cleanupError) {
				console.error('Failed to roll back user after mailbox creation failed', cleanupError);
			}
		}
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create user' },
			{ status: 400 }
		);
	}
};
