import { json, type RequestHandler } from '@sveltejs/kit';
import { createPairingCode } from '$lib/server/auth';

/** Web (session-authed) creates a one-time code to show as a QR code. */
export const POST: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const pairing = await createPairingCode(db, locals.user.id);
	return json(pairing, { headers: { 'Cache-Control': 'no-store' } });
};
