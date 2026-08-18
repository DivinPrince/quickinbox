import { redirect, type Handle } from '@sveltejs/kit';
import { countUsers, getUserFromSession, readSessionToken } from '$lib/server/auth';
import { DOMAIN_COOKIE } from '$lib/server/constants';
import { listAddressesForUser, listDomains } from '$lib/server/domains';

const PUBLIC_PREFIXES = ['/login', '/setup', '/api/auth', '/api/setup', '/api/webhooks'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	event.locals.user = null;
	event.locals.domains = [];
	event.locals.addresses = [];
	event.locals.activeDomainId = null;

	if (db) {
		const token = readSessionToken(event.cookies);
		event.locals.user = await getUserFromSession(db, token);
	}

	const { pathname } = event.url;

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
