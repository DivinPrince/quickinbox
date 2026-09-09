import { redirect, type Handle } from '@sveltejs/kit';
import { authorizeApiRequest, canAccessDuringFirstLogin } from '$lib/server/api-access';
import { getUserByApiToken, readBearerToken } from '$lib/server/api-tokens';
import { getUserByOAuthToken } from '$lib/server/oauth';
import {
	countUsers,
	getAuthenticatedSession,
	readSessionToken,
	sessionCookieOptions,
	SESSION_COOKIE,
	type AuthenticatedSession
} from '$lib/server/auth';
import { readLinkedTokens, resolveLinkedSessions, toLinkedAccounts, writeLinkedTokens } from '$lib/server/accounts';
import {
	DOMAIN_COOKIE,
	SESSION_DAYS,
	UI_THEME_COOKIE,
	UI_THEME_COOKIE_MAX_AGE
} from '$lib/server/constants';
import { listAddressesForUser, listDomains } from '$lib/server/domains';
import { loginHref, safeNextPath } from '$lib/next-url';
import { getUserLocale } from '$lib/server/locale';
import { getUserUiTheme } from '$lib/server/ui-theme';
import { BUILTIN_THEME_IDS, DEFAULT_UI_THEME, parseThemeId } from '$lib/ui-theme/ids';
import {
	DEFAULT_LOCALE,
	LOCALE_COOKIE,
	LOCALE_COOKIE_MAX_AGE,
	localeFromAcceptLanguage,
	matchLocale
} from '$lib/i18n/locales';

const PUBLIC_PREFIXES = [
	'/login',
	'/setup',
	'/api/auth/login',
	'/api/auth/pair',
	'/api/setup',
	'/api/webhooks',
	'/install.sh'
];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The hosted MCP endpoint and its OAuth server. Called by AI clients, not
 * browsers: they authenticate with bearer tokens inside the route, need CORS
 * for browser-based clients, and must never be bounced to the login page.
 * `/oauth/authorize` is deliberately absent — that is the consent page and
 * uses the normal session flow.
 */
const MCP_PREFIXES = ['/mcp', '/oauth/register', '/oauth/token', '/oauth/revoke', '/.well-known/oauth-'];

function isMcpPath(pathname: string): boolean {
	return MCP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function corsHeaders(request: Request): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers':
			'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
		// Browser clients discover the authorization server from the 401 challenge.
		'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin'
	};
}

function withCors(response: Response, request: Request): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(error: string, status: number): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function render(
	event: Parameters<Handle>[0]['event'],
	resolve: Parameters<Handle>[0]['resolve']
): ReturnType<Handle> {
	const uiTheme = event.locals.uiTheme || DEFAULT_UI_THEME;
	const locale = event.locals.locale || DEFAULT_LOCALE;
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace(
				'<html lang="en">',
				`<html lang="${locale}" data-ui-theme="${uiTheme}">`
			)
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	const { pathname } = event.url;
	const forwardedProtocol = event.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
	const effectiveProtocol = forwardedProtocol ? `${forwardedProtocol}:` : event.url.protocol;
	const isLocalDevelopment =
		event.url.hostname === 'localhost' ||
		event.url.hostname === '127.0.0.1' ||
		event.url.hostname === '[::1]';

	if (effectiveProtocol === 'http:' && !isLocalDevelopment) {
		const secureUrl = new URL(event.url);
		secureUrl.protocol = 'https:';
		throw redirect(308, secureUrl.toString());
	}

	event.locals.user = null;
	event.locals.authMethod = null;
	event.locals.apiScopes = [];
	event.locals.apiTokenId = null;
	event.locals.domains = [];
	event.locals.addresses = [];
	event.locals.activeDomainId = null;
	event.locals.currentSessionId = null;
	event.locals.accounts = [];
	event.locals.uiTheme = parseThemeId(event.cookies.get(UI_THEME_COOKIE), BUILTIN_THEME_IDS);
	event.locals.locale =
		matchLocale(event.cookies.get(LOCALE_COOKIE)) ??
		localeFromAcceptLanguage(event.request.headers.get('accept-language'));

	if (isMcpPath(pathname)) {
		if (event.request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(event.request) });
		}
		return withCors(await resolve(event), event.request);
	}

	if (db) {
		// Browser sessions take precedence so an incidental or stale Authorization
		// header cannot downgrade a legitimate cookie-authenticated API request.
		const activeToken = readSessionToken(event.cookies);
		let cookieSession: AuthenticatedSession | null = await getAuthenticatedSession(db, activeToken);

		// Other accounts signed in on this browser. Only page loads need them (the
		// switcher); API calls stay single-user and skip the extra query.
		const linkedTokens = pathname.startsWith('/api/') ? [] : readLinkedTokens(event.cookies);
		if (linkedTokens.length > 0) {
			const parked = await resolveLinkedSessions(
				db,
				linkedTokens.filter((token) => token !== activeToken)
			);

			// The active session expired or was revoked: fall through to the next
			// account instead of bouncing to the login page.
			if (!cookieSession || cookieSession.isMobile) {
				const next = parked.shift();
				if (next) {
					event.cookies.set(
						SESSION_COOKIE,
						next.token,
						sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60, event.url)
					);
					cookieSession = { user: next.user, sessionId: next.sessionId, isMobile: false };
				}
			}

			const others = parked.filter((session) => session.user.id !== cookieSession?.user.id);
			const keep = others.map((session) => session.token);
			if (keep.length !== linkedTokens.length || keep.some((token, i) => token !== linkedTokens[i])) {
				writeLinkedTokens(event.cookies, keep, event.url);
			}

			if (cookieSession && !cookieSession.isMobile) {
				event.locals.accounts = toLinkedAccounts(
					{ user: cookieSession.user, address: null },
					others
				);
			}
		}

		if (cookieSession && !cookieSession.isMobile) {
			event.locals.user = cookieSession.user;
			event.locals.currentSessionId = cookieSession.sessionId;
			event.locals.authMethod = 'session';
		} else if (pathname.startsWith('/api/')) {
			const bearer = readBearerToken(event.request);
			if (bearer) {
				const apiToken = await getUserByApiToken(db, bearer);
				if (apiToken) {
					event.locals.user = apiToken.user;
					event.locals.authMethod = 'api_token';
					event.locals.apiScopes = apiToken.scopes;
					event.locals.apiTokenId = apiToken.tokenId;
				} else {
					const oauth = await getUserByOAuthToken(db, bearer);
					if (oauth) {
						event.locals.user = oauth.user;
						event.locals.authMethod = 'api_token';
						event.locals.apiScopes = oauth.scopes;
					} else {
						const bearerSession = await getAuthenticatedSession(db, bearer);
						if (bearerSession?.isMobile) {
							event.locals.user = bearerSession.user;
							event.locals.currentSessionId = bearerSession.sessionId;
							event.locals.authMethod = 'mobile_session';
						}
					}
				}
			}
		}
	}

	// Webhooks authenticate with a signature, not a session.
	if (pathname.startsWith('/api/webhooks/')) {
		return render(event, resolve);
	}

	if (db && event.locals.user) {
		if (event.locals.user.must_change_password) {
			event.locals.domains = [];
			event.locals.addresses = [];
		} else {
			const [domains, addresses] = await Promise.all([
				listDomains(db),
				listAddressesForUser(db, event.locals.user.id)
			]);

			event.locals.domains = domains;
			event.locals.addresses = addresses;

			// The switcher labels each account by its default sending address, so
			// give the active account the same treatment as the parked ones.
			const current = event.locals.accounts.find((account) => account.current);
			if (current) {
				current.address =
					addresses.find((address) => address.is_default)?.address ?? addresses[0]?.address ?? null;
			}

			// Scripts pass `?domain=`; the dashboard uses a cookie.
			const requested = pathname.startsWith('/api/')
				? event.url.searchParams.get('domain')
				: event.cookies.get(DOMAIN_COOKIE);
			event.locals.activeDomainId =
				requested && domains.some((domain) => domain.id === requested) ? requested : null;
		}
	}

	if (event.locals.user?.must_change_password && event.locals.authMethod === 'api_token') {
		event.locals.user = null;
		event.locals.authMethod = null;
		event.locals.apiScopes = [];
		event.locals.apiTokenId = null;
	}

	if (pathname.startsWith('/api/')) {
		if (isPublicPath(pathname)) {
			return render(event, resolve);
		}
		if (!event.locals.user || !event.locals.authMethod) {
			return jsonError('Unauthorized', 401);
		}
		if (
			event.locals.user.must_change_password &&
			!canAccessDuringFirstLogin(pathname, event.request.method)
		) {
			return jsonError('Complete account setup before continuing', 403);
		}
		if (canAccessDuringFirstLogin(pathname, event.request.method)) {
			return render(event, resolve);
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

		return render(event, resolve);
	}

	if (db && event.locals.user && !event.locals.user.must_change_password) {
		const [storedTheme, storedLocale] = await Promise.all([
			getUserUiTheme(db, event.locals.user.id),
			getUserLocale(db, event.locals.user.id)
		]);
		event.locals.uiTheme = storedTheme;
		event.locals.locale = storedLocale;
		if (event.cookies.get(UI_THEME_COOKIE) !== storedTheme) {
			event.cookies.set(UI_THEME_COOKIE, storedTheme, {
				path: '/',
				maxAge: UI_THEME_COOKIE_MAX_AGE,
				sameSite: 'lax',
				httpOnly: false
			});
		}
		if (event.cookies.get(LOCALE_COOKIE) !== storedLocale) {
			event.cookies.set(LOCALE_COOKIE, storedLocale, {
				path: '/',
				maxAge: LOCALE_COOKIE_MAX_AGE,
				sameSite: 'lax',
				httpOnly: false
			});
		}
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
		return render(event, resolve);
	}

	if (pathname === '/login') {
		// `?add=1` is the "add another account" flow: a signed-in user may reach
		// the form so long as their own account is fully set up. `?setup=complete`
		// is the same situation after first-login setup: that account's session was
		// revoked, another signed-in account may have been promoted, and the person
		// still needs to sign back in as the one they just set up.
		const addingAccount =
			(event.url.searchParams.get('add') === '1' ||
				event.url.searchParams.get('setup') === 'complete') &&
			!event.locals.user?.must_change_password;
		if (event.locals.user && !addingAccount) {
			throw redirect(
				303,
				event.locals.user.must_change_password
					? '/account/setup'
					: safeNextPath(event.url.searchParams.get('next')) ?? '/inbox'
			);
		}
		return render(event, resolve);
	}

	if (isPublicPath(pathname)) {
		return render(event, resolve);
	}

	if (!event.locals.user) {
		// An OAuth consent request survives the sign-in detour; nothing else does.
		const resume = safeNextPath(`${pathname}${event.url.search}`);
		throw redirect(303, resume ? loginHref(resume) : '/login');
	}

	if (event.locals.user.must_change_password) {
		if (pathname !== '/account/setup') {
			throw redirect(303, '/account/setup');
		}
		return render(event, resolve);
	}

	if (pathname === '/account/setup') {
		throw redirect(303, '/inbox');
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

	return render(event, resolve);
};
