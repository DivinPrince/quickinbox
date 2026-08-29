import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SETTINGS_SECTIONS } from '$lib/settings-section';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (locals.uiTheme === 'classic') {
		throw redirect(303, '/settings');
	}

	const section = SETTINGS_SECTIONS.find((name) => name === params.section);
	if (!section) {
		throw error(404, 'Not found');
	}

	return { section };
};
