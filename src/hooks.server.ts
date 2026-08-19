import { redirect, type Handle } from '@sveltejs/kit';
import { authorizeApiRequest } from '$lib/server/api-access';
import { getUserByApiToken, readBearerToken } from '$lib/server/api-tokens';
import { countUsers, getUserFromSession, readSessionToken } from '$lib/server/auth';
import { DOMAIN_COOKIE } from '$lib/server/constants';
import { listAddressesForUser, listDomains } from '$lib/server/domains';

const PUBLIC_PREFIXES = [
	'/login',
	'/setup',
	'/api/auth',
	'/api/setup',
	'/api/webhooks',
	'/install.sh'
];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function jsonError(error: string, status: number): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	event.locals.user = null;
	event.locals.authMethod = null;
	event.locals.apiScopes = [];
	event.locals.apiTokenId = null;
	event.locals.domains = [];
	event.locals.addresses = [];
	event.locals.activeDomainId = null;

	const { pathname } = event.url;

	if (db) {
		const session = readSessionToken(event.cookies);
		event.locals.user = await getUserFromSession(db, session);
		if (event.locals.user) {
			event.locals.authMethod = 'session';
		} else if (pathname.startsWith('/api/')) {
			const bearer = readBearerToken(event.request);
			if (bearer) {
				const auth = await getUserByApiToken(db, bearer);
				if (auth) {
					event.locals.user = auth.user;
					event.locals.authMethod = 'api_token';
					event.locals.apiScopes = auth.scopes;
					event.locals.apiTokenId = auth.tokenId;
				}
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

		// Scripts pass `?domain=`; the dashboard uses a cookie.
		const requested = pathname.startsWith('/api/')
			? event.url.searchParams.get('domain')
			: event.cookies.get(DOMAIN_COOKIE);
		event.locals.activeDomainId =
			requested && domains.some((domain) => domain.id === requested) ? requested : null;
	}

	if (pathname.startsWith('/api/')) {
		if (isPublicPath(pathname)) {
			return resolve(event);
		}
		if (!event.locals.user || !event.locals.authMethod) {
			return jsonError('Unauthorized', 401);
		}

		const access = authorizeApiRequest({
			pathname,
			method: event.request.method,
			authMethod: event.locals.authMethod,
			scopes: event.locals.apiScopes
		});
		if (!access.ok) {
			return jsonError(access.error, access.status);
		}

		return resolve(event);
	}

	const needsSetup = db ? (await countUsers(db)) === 0 : false;

	if (
		needsSetup &&
		pathname !== '/setup' &&
		pathname !== '/install.sh'
	) {
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
	const needsOnboarding = event.locals.domains.length === 0 || event.locals.addresses.length === 0;

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
