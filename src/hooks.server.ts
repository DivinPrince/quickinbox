import { redirect, type Handle } from '@sveltejs/kit';
import { countUsers, getUserFromSession, readSessionToken } from '$lib/server/auth';
import { type ApiScope, getUserByApiToken, readBearerToken } from '$lib/server/api-tokens';
import { DOMAIN_COOKIE } from '$lib/server/constants';
import { listAddressesForUser, listDomains } from '$lib/server/domains';

const PUBLIC_PREFIXES = ['/login', '/setup', '/api/auth', '/api/setup', '/api/webhooks'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Where an API key may go, and what scope it must carry to get there. A key is
 * a narrow credential for scripted mail, not a portable session.
 *
 * Only the two documented operations are reachable -- list/read mail, and send
 * it. Everything else stays session-only, deliberately: key management (so a
 * leaked key cannot mint its own replacement and outlive revocation), admin,
 * domains, addresses, settings, and every mailbox mutation. Note that trashing
 * lives on `PATCH/DELETE /api/mail/<id>` and `POST /api/mail/actions`, so those
 * are absent here rather than merely unscoped.
 *
 * First match wins; a method missing from a matched rule is refused.
 */
const BEARER_ROUTES: { match: RegExp; scopes: Partial<Record<string, ApiScope>> }[] = [
	// List, and send.
	{ match: /^\/api\/mail$/, scopes: { GET: 'mail:read', POST: 'mail:send' } },
	// Read one message, or download one of its attachments. `actions` is
	// excluded explicitly -- it is bulk trash/star, not a message id.
	{
		match: /^\/api\/mail\/(?!actions$)[^/]+(?:\/attachments\/[^/]+)?$/,
		scopes: { GET: 'mail:read' }
	}
];

/** The scope a bearer token needs here, or null if it may not go here at all. */
function requiredScopeFor(pathname: string, method: string): ApiScope | null {
	const route = BEARER_ROUTES.find((candidate) => candidate.match.test(pathname));
	return route?.scopes[method] ?? null;
}

function jsonError(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	event.locals.user = null;
	event.locals.domains = [];
	event.locals.addresses = [];
	event.locals.activeDomainId = null;
	// Null for browser sessions -- only a bearer-authenticated request is scoped.
	event.locals.apiToken = null;

	const { pathname } = event.url;

	if (db) {
		// Browser sessions first; then, for API calls, a long-lived bearer token
		// (generated under Settings → API keys) so scripts can authenticate
		// without a session cookie.
		const token = readSessionToken(event.cookies);
		event.locals.user = await getUserFromSession(db, token);

		if (!event.locals.user && pathname.startsWith('/api/')) {
			const bearer = readBearerToken(event.request);
			const identity = bearer ? await getUserByApiToken(db, bearer) : null;

			if (identity) {
				const required = requiredScopeFor(pathname, event.request.method);

				// Off the allowlist entirely, or the wrong verb on a listed route.
				if (!required) {
					return jsonError(403, 'This endpoint requires a signed-in session');
				}
				if (!identity.scopes.includes(required)) {
					return jsonError(403, `This API key is missing the ${required} scope`);
				}

				event.locals.user = identity.user;
				event.locals.apiToken = { id: identity.tokenId, scopes: identity.scopes };
			}
		}
	}

	// Webhooks authenticate with a signature, not a session.
	if (pathname.startsWith('/api/webhooks/')) {
		return resolve(event);
	}

	if (db && event.locals.user) {
		const [domains, addresses] = await Promise.all([
			listDomains(db),
			listAddressesForUser(db, event.locals.user.id)
		]);

		event.locals.domains = domains;
		event.locals.addresses = addresses;

		// Only honour a domain filter that is still connected.
		const selected = event.cookies.get(DOMAIN_COOKIE);
		event.locals.activeDomainId =
			selected && domains.some((domain) => domain.id === selected) ? selected : null;
	}

	if (pathname.startsWith('/api/')) {
		if (isPublicPath(pathname)) {
			return resolve(event);
		}
		if (!event.locals.user) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return resolve(event);
	}

	const needsSetup = db ? (await countUsers(db)) === 0 : false;

	if (needsSetup && pathname !== '/setup') {
		throw redirect(303, '/setup');
	}

	if (pathname === '/setup') {
		if (!needsSetup && event.locals.user) {
			throw redirect(303, '/inbox');
		}
		if (!needsSetup && !event.locals.user) {
			throw redirect(303, '/login');
		}
		return resolve(event);
	}

	if (pathname === '/login') {
		if (event.locals.user) {
			throw redirect(303, '/inbox');
		}
		return resolve(event);
	}

	if (isPublicPath(pathname)) {
		return resolve(event);
	}

	if (!event.locals.user) {
		throw redirect(303, '/login');
	}

	// Nothing works until a provider domain is connected and the user owns an
	// address on it, so send them through onboarding first.
	const needsOnboarding =
		event.locals.domains.length === 0 || event.locals.addresses.length === 0;

	if (needsOnboarding && pathname !== '/onboarding') {
		throw redirect(303, '/onboarding');
	}

	if (!needsOnboarding && pathname === '/onboarding') {
		throw redirect(303, '/inbox');
	}

	if (pathname.startsWith('/admin') && !event.locals.user.is_admin) {
		throw redirect(303, '/inbox');
	}

	return resolve(event);
};
