import type { RequestHandler } from './$types';
import { listContacts, saveContact } from '$lib/server/contacts';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const limit = Number(event.url.searchParams.get('limit') || 100),
		offset = Number(event.url.searchParams.get('offset') || 0);
	return organizerJson(
		await listContacts(
			env.DB,
			user.id,
			event.url.searchParams.get('q') || '',
			Number.isFinite(limit) ? Math.min(100, limit) : 100,
			Number.isFinite(offset) ? offset : 0
		)
	);
};
export const POST: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	return organizerJson(
		{ contact: await saveContact(env.DB, user.id, await organizerBody(event.request)) },
		201
	);
};
