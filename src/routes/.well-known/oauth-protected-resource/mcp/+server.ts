import { json, type RequestHandler } from '@sveltejs/kit';
import { protectedResourceMetadata } from '$lib/server/oauth';

/** RFC 9728 path-suffixed variant, referenced from the `/mcp` 401 challenge. */
export const GET: RequestHandler = ({ url }) =>
	json(protectedResourceMetadata(url.origin), {
		headers: { 'Cache-Control': 'public, max-age=3600' }
	});
