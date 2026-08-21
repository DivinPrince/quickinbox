import { json, type RequestHandler } from '@sveltejs/kit';
import { createAddress, listAddressesForUser, listAllAddresses } from '$lib/server/domains';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const all =
		url.searchParams.get('all') === '1' &&
		locals.user.is_admin &&
		(locals.authMethod === 'session' || locals.apiScopes.includes('admin'));
	const addresses = all
		? await listAllAddresses(db)
		: await listAddressesForUser(db, locals.user.id);

	return json({ addresses });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as {
		domainId?: string;
		localPart?: string;
		label?: string;
		userId?: string;
	};

	if (!body.domainId || !body.localPart) {
		return json({ error: 'Pick a domain and enter an address' }, { status: 400 });
	}

	// Admins can provision addresses for other users; everyone else gets their own.
	const userId = locals.user.is_admin && body.userId ? body.userId : locals.user.id;

	try {
		const address = await createAddress(db, {
			userId,
			domainId: body.domainId,
			localPart: body.localPart,
			label: body.label ?? null
		});
		return json({ address }, { status: 201 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create address' },
			{ status: 400 }
		);
	}
};
