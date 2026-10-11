import type { RequestHandler } from '@sveltejs/kit';
import { authenticateMailEvents } from '$lib/server/mail-events';
import { bearerChallenge } from '$lib/server/oauth';

/** Dedicated stateful Events endpoint; /mcp remains the stateless mail-tool server. */
const handle: RequestHandler = async ({ request, platform, url }) => {
	const env = platform?.env;
	if (!env?.DB || !env.MAIL_EVENTS) return new Response('Mail events unavailable', { status: 503 });
	const auth = await authenticateMailEvents(env.DB, request);
	if (!auth) return new Response('Mail read access required', {
		status: 401,
		headers: { 'WWW-Authenticate': bearerChallenge(url.origin) }
	});
	const broker = env.MAIL_EVENTS.get(env.MAIL_EVENTS.idFromName(auth.userId));
	// Buffer before crossing the DO boundary: an expired session can reject the
	// request before reading its body, while Workers is still pumping the stream.
	// Public callers cannot select the broker's internal publication hostname.
	const forwarded = new Request('https://mail-events.client/mcp/events', {
		method: request.method,
		headers: request.headers,
		body: request.method === 'POST' ? await request.arrayBuffer() : undefined
	});
	// Workers and SvelteKit use distinct Fetch declarations for the same runtime API.
	return (broker.fetch.bind(broker) as unknown as typeof fetch)(forwarded);
};

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
