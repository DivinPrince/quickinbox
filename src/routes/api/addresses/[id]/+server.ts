import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteAddress, listAddressesForUser, setDefaultAddress } from '$lib/server/domains';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as { isDefault?: boolean };
	if (body.isDefault) {
		await setDefaultAddress(db, locals.user.id, params.id!);
	}

	return json({ addresses: await listAddressesForUser(db, locals.user.id) });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const addresses = await listAddressesForUser(db, locals.user.id);
	if (addresses.length <= 1) {
		return json({ error: 'Keep at least one address' }, { status: 400 });
	}

	await deleteAddress(db, locals.user.id, params.id!);
	const remaining = await listAddressesForUser(db, locals.user.id);

	// Never leave the user without a default sending identity.
	if (remaining.length > 0 && !remaining.some((address) => address.is_default)) {
		await setDefaultAddress(db, locals.user.id, remaining[0].id);
	}

	return json({ addresses: await listAddressesForUser(db, locals.user.id) });
};
