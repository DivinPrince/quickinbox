import type { PageServerLoad } from './$types';
import { organizerSession } from '$lib/server/organizer-http';
import { listContacts, contactByEmail } from '$lib/server/contacts';
export const load: PageServerLoad = async (event) => {
	const { env, user } = organizerSession(event);
	const email = (event.url.searchParams.get('email') || '').slice(0, 254);
	return {
		...(await listContacts(env.DB, user.id)),
		existing: email ? await contactByEmail(env.DB, user.id, email) : null,
		seed: { email, name: (event.url.searchParams.get('name') || '').slice(0, 200) }
	};
};
