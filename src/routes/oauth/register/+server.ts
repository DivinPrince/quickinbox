import { json, type RequestHandler } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/auth';
import { OAuthError, registerClient, registrationResponse } from '$lib/server/oauth';

/** RFC 7591 dynamic client registration. Public clients only. */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'server_error', error_description: 'Database unavailable' }, { status: 503 });

	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (!(await checkRateLimit(db, `oauth-register:${ip}`, 30, 60 * 60))) {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'Too many registrations; try again later' },
			{ status: 429 }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, { status: 400 });
	}

	try {
		const client = await registerClient(db, body);
		return json(registrationResponse(client), { status: 201, headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof OAuthError) return json(error.toJSON(), { status: error.status });
		throw error;
	}
};
