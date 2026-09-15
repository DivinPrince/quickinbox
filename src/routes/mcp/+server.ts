import type { D1Database } from '@cloudflare/workers-types';
import type { RequestHandler } from '@sveltejs/kit';
import { getUserByApiToken, readBearerToken } from '$lib/server/api-tokens';
import { getEmailProvider } from '$lib/server/context';
import { handleMcpRequest } from '$lib/server/mcp';
import { bearerChallenge, getUserByOAuthToken } from '$lib/server/oauth';
import type { User } from '$lib/types';

/**
 * The hosted MCP endpoint. Authenticates with an OAuth access token issued by
 * this server's `/oauth/*` endpoints — or, for people who already have one, a
 * `qi_live_` API key — then hands the JSON-RPC body to the MCP SDK.
 */

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }),
		{ status, headers: { 'Content-Type': 'application/json', ...headers } }
	);
}

async function authenticate(
	db: D1Database,
	request: Request
): Promise<{ user: User; scopes: readonly string[] } | null> {
	const bearer = readBearerToken(request);
	if (!bearer) return null;
	const oauth = await getUserByOAuthToken(db, bearer);
	if (oauth) return { user: oauth.user, scopes: oauth.scopes };
	const apiToken = await getUserByApiToken(db, bearer);
	if (apiToken) return { user: apiToken.user, scopes: apiToken.scopes };
	return null;
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
	const db = platform?.env.DB;
	if (!db) return rpcError(503, 'Database unavailable');

	const bearer = readBearerToken(request);
	if (!bearer) {
		return rpcError(401, 'Authorization required', { 'WWW-Authenticate': bearerChallenge(url.origin) });
	}
	const auth = await authenticate(db, request);
	if (!auth) {
		return rpcError(401, 'Invalid or expired token', {
			'WWW-Authenticate': bearerChallenge(url.origin, {
				error: 'invalid_token',
				description: 'The access token is invalid, expired, or revoked'
			})
		});
	}

	return handleMcpRequest(request, {
		db,
		bucket: platform?.env.ATTACHMENTS,
		provider: () => getEmailProvider(platform),
		user: auth.user,
		scopes: auth.scopes,
		origin: url.origin
	});
};

/** Stateless server: no SSE stream to open and no session to end. */
const methodNotAllowed: RequestHandler = () =>
	rpcError(405, 'This MCP server is stateless; send JSON-RPC requests with POST', { Allow: 'POST, OPTIONS' });

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
