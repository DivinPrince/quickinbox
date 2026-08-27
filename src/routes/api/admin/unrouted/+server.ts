import { json, type RequestHandler } from '@sveltejs/kit';
import { listUnroutedEmails } from '$lib/server/domains';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
	return json({ unrouted: await listUnroutedEmails(db, limit) });
};
