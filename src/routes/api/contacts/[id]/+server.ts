import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteContact, getContact, saveContact } from '$lib/server/contacts';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const contact = await getContact(env.DB, user.id, event.params.id);
	if (!contact) throw error(404, 'Contact not found');
	return organizerJson({ contact });
};
export const PUT: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	if (!(await getContact(env.DB, user.id, event.params.id))) throw error(404, 'Contact not found');
	return organizerJson({
		contact: await saveContact(env.DB, user.id, await organizerBody(event.request), event.params.id)
	});
};
export const DELETE: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const raw = (await organizerBody(event.request)) as { version?: number };
	if (!Number.isInteger(raw?.version)) throw error(400, 'Contact version required');
	await deleteContact(env.DB, user.id, event.params.id, raw.version!);
	return organizerJson({ ok: true });
};
