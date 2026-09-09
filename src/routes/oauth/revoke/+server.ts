import { json, type RequestHandler } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/auth';
import { revokeToken } from '$lib/server/oauth';

/** RFC 7009. Always 200 — the RFC forbids leaking whether the token existed. */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'server_error', error_description: 'Database unavailable' }, { status: 503 });

	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (!(await checkRateLimit(db, `oauth-revoke:${ip}`, 120, 60))) {
		return json({ error: 'invalid_request', error_description: 'Too many revocation requests' }, { status: 429 });
	}

	const type = request.headers.get('content-type') ?? '';
	let token: string | undefined;
	let clientId: string | undefined;
	if (type.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (typeof body?.token === 'string') token = body.token;
		if (typeof body?.client_id === 'string') clientId = body.client_id;
	} else {
		const form = new URLSearchParams(await request.text());
		token = form.get('token') ?? undefined;
		clientId = form.get('client_id') ?? undefined;
	}

	if (!token) {
		return json({ error: 'invalid_request', error_description: 'token is required' }, { status: 400 });
	}
	await revokeToken(db, token, clientId);
	return json({}, { headers: { 'Cache-Control': 'no-store' } });
};
