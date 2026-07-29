import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ user: null }, { status: 401 });
	}
	return json({ user: locals.user });
};
