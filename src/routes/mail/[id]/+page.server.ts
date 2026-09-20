import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEmailForUser } from '$lib/server/mail-store';
import { loadThreadView } from '$lib/server/thread-view';
import { folderPath, mailboxViewForEmail } from '$lib/mail/folders';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const email = await getEmailForUser(platform.env.DB, locals.user.id, params.id);
	if (!email) {
		throw error(404, 'Email not found');
	}

	if (locals.uiTheme !== 'classic') {
		throw redirect(303, `${folderPath(mailboxViewForEmail(email))}?thread=${encodeURIComponent(email.id)}`);
	}

	return loadThreadView(platform.env.DB, locals.user, email);
};
