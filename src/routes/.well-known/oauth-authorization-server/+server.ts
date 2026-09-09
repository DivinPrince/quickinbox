import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizationServerMetadata } from '$lib/server/oauth';

/** RFC 8414 — how MCP clients find the authorize/token/register endpoints. */
export const GET: RequestHandler = ({ url }) =>
	json(authorizationServerMetadata(url.origin), {
		headers: { 'Cache-Control': 'public, max-age=3600' }
	});
