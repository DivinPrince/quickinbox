import { json, type RequestHandler } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/auth';
import {
	consumeAuthorizationCode,
	deleteExpiredCodes,
	issueGrant,
	isValidCodeVerifier,
	mcpResourceUri,
	OAuthError,
	refreshGrant,
	verifyPkce
} from '$lib/server/oauth';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/** Token requests arrive form-encoded (the norm) or as JSON (some SDKs). */
async function readParams(request: Request): Promise<Record<string, string>> {
	const type = request.headers.get('content-type') ?? '';
	const out: Record<string, string> = {};
	if (type.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		for (const [key, value] of Object.entries(body ?? {})) {
			if (typeof value === 'string') out[key] = value;
		}
		return out;
	}
	const form = new URLSearchParams(await request.text());
	for (const [key, value] of form) out[key] = value;
	return out;
}

/** RFC 6749 §4.1.3 + §6, with PKCE (RFC 7636) mandatory. */
export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'server_error', error_description: 'Database unavailable' }, { status: 503 });

	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (!(await checkRateLimit(db, `oauth-token:${ip}`, 120, 60))) {
		return json({ error: 'invalid_request', error_description: 'Too many token requests' }, { status: 429, headers: NO_STORE });
	}

	const params = await readParams(request);
	try {
		const clientId = params.client_id?.trim();
		if (!clientId) throw new OAuthError('invalid_client', 'client_id is required', 401);

		switch (params.grant_type) {
			case 'authorization_code': {
				if (!params.code) throw new OAuthError('invalid_request', 'code is required');
				if (!isValidCodeVerifier(params.code_verifier)) {
					throw new OAuthError('invalid_request', 'code_verifier is required (PKCE)');
				}
				const code = await consumeAuthorizationCode(db, params.code);
				if (!code) throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired');
				if (code.client_id !== clientId) {
					throw new OAuthError('invalid_grant', 'Authorization code was issued to a different client');
				}
				if (params.redirect_uri !== undefined && params.redirect_uri !== code.redirect_uri) {
					throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
				}
				if (!(await verifyPkce(params.code_verifier, code.code_challenge))) {
					throw new OAuthError('invalid_grant', 'PKCE verification failed');
				}
				if (params.resource && params.resource !== code.resource) {
					throw new OAuthError('invalid_target', `This server issues tokens for ${mcpResourceUri(url.origin)} only`);
				}
				const tokens = await issueGrant(db, {
					clientId,
					userId: code.user_id,
					scope: code.scope,
					resource: code.resource
				});
				// Cheap housekeeping while we are here.
				void deleteExpiredCodes(db).catch(() => {});
				return json(tokens, { headers: NO_STORE });
			}
			case 'refresh_token': {
				if (!params.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required');
				const tokens = await refreshGrant(db, {
					refreshToken: params.refresh_token,
					clientId,
					scope: params.scope
				});
				return json(tokens, { headers: NO_STORE });
			}
			default:
				throw new OAuthError(
					'unsupported_grant_type',
					'grant_type must be authorization_code or refresh_token'
				);
		}
	} catch (error) {
		if (error instanceof OAuthError) {
			return json(error.toJSON(), { status: error.status, headers: NO_STORE });
		}
		throw error;
	}
};
