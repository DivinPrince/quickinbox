import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.uiTheme !== 'classic') {
		throw redirect(303, '/settings/general');
	}
	return {};
};
