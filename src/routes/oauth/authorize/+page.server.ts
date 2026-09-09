import type { D1Database } from '@cloudflare/workers-types';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readLinkedTokens, resolveLinkedSessions } from '$lib/server/accounts';
import {
	getClient,
	isValidCodeChallenge,
	issueAuthorizationCode,
	mcpResourceUri,
	normalizeScope,
	OAuthError,
	redirectUriMatches,
	type OAuthClient,
	type OAuthScope
} from '$lib/server/oauth';
import { loginHref } from '$lib/next-url';

/**
 * The consent screen. GET validates the request and renders it; POST records
 * the decision and sends the browser back to the client with a code.
 *
 * Every parameter is re-validated on POST, so the hidden fields are just a
 * convenience — tampering with them buys nothing that editing the GET URL
 * would not. SvelteKit's origin check covers CSRF on the form.
 */

type AuthorizeRequest = {
	client: OAuthClient;
	redirectUri: string;
	scope: OAuthScope[];
	state: string | null;
	codeChallenge: string;
	resource: string;
};

/** Errors before the redirect URI is trusted render in place; after, they redirect. */
class AuthorizeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly redirectUri: string | null = null,
		readonly state: string | null = null
	) {
		super(message);
	}
}

type ParamSource = { get(name: string): string | null | File };

function param(source: ParamSource, name: string, max = 2048): string | null {
	const value = source.get(name);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > max) return null;
	return trimmed;
}

async function parseAuthorizeRequest(
	db: D1Database,
	origin: string,
	source: ParamSource,
	fetchImpl: typeof fetch
): Promise<AuthorizeRequest> {
	const clientId = param(source, 'client_id');
	if (!clientId) throw new AuthorizeError('invalid_request', 'client_id is required');

	let client: OAuthClient | null;
	try {
		client = await getClient(db, clientId, fetchImpl);
	} catch (error) {
		if (error instanceof OAuthError) throw new AuthorizeError(error.code, error.message);
		throw error;
	}
	if (!client) throw new AuthorizeError('invalid_client', 'This client is not registered with this server');

	const requestedRedirect = param(source, 'redirect_uri');
	let redirectUri: string;
	if (requestedRedirect) {
		if (!redirectUriMatches(client.redirect_uris, requestedRedirect)) {
			throw new AuthorizeError('invalid_request', 'redirect_uri is not registered for this client');
		}
		redirectUri = requestedRedirect;
	} else if (client.redirect_uris.length === 1) {
		redirectUri = client.redirect_uris[0];
	} else {
		throw new AuthorizeError('invalid_request', 'redirect_uri is required');
	}

	// From here on the client is real and the redirect is trusted, so problems
	// go back to it (RFC 6749 §4.1.2.1).
	const state = param(source, 'state');
	const bounce = (code: string, message: string) => new AuthorizeError(code, message, redirectUri, state);

	if (param(source, 'response_type') !== 'code') {
		throw bounce('unsupported_response_type', 'response_type must be code');
	}
	const codeChallenge = param(source, 'code_challenge');
	if (!isValidCodeChallenge(codeChallenge)) {
		throw bounce('invalid_request', 'code_challenge is required (PKCE S256)');
	}
	const method = param(source, 'code_challenge_method') ?? 'S256';
	if (method !== 'S256') {
		throw bounce('invalid_request', 'code_challenge_method must be S256');
	}
	let scope: OAuthScope[];
	try {
		scope = normalizeScope(param(source, 'scope'));
	} catch (error) {
		if (error instanceof OAuthError) throw bounce(error.code, error.message);
		throw error;
	}
	const resource = param(source, 'resource') ?? mcpResourceUri(origin);
	if (resource !== mcpResourceUri(origin)) {
		throw bounce('invalid_target', `This server issues tokens for ${mcpResourceUri(origin)} only`);
	}

	return { client, redirectUri, scope, state, codeChallenge, resource };
}

function redirectWith(origin: string, redirectUri: string, params: Record<string, string | null>): string {
	const url = new URL(redirectUri);
	for (const [key, value] of Object.entries(params)) {
		if (value !== null) url.searchParams.set(key, value);
	}
	// RFC 9207: tell the client which server answered, so mix-up attacks fail.
	url.searchParams.set('iss', origin);
	return url.toString();
}

function handleAuthorizeError(origin: string, error: unknown): { code: string; message: string } {
	if (!(error instanceof AuthorizeError)) throw error;
	if (error.redirectUri) {
		throw redirect(
			303,
			redirectWith(origin, error.redirectUri, {
				error: error.code,
				error_description: error.message,
				state: error.state
			})
		);
	}
	return { code: error.code, message: error.message };
}

export const load: PageServerLoad = async ({ url, locals, platform, fetch, setHeaders }) => {
	const db = platform?.env.DB;
	if (!locals.user || !db) {
		throw redirect(303, loginHref(`${url.pathname}${url.search}`));
	}
	setHeaders({ 'cache-control': 'no-store' });

	let request: AuthorizeRequest;
	try {
		request = await parseAuthorizeRequest(db, url.origin, url.searchParams, fetch);
	} catch (error) {
		return { invalid: handleAuthorizeError(url.origin, error), request: null };
	}

	return {
		invalid: null,
		request: {
			client: {
				client_id: request.client.client_id,
				client_name: request.client.client_name,
				client_uri: request.client.client_uri,
				logo_uri: request.client.logo_uri
			},
			redirectUri: request.redirectUri,
			scope: request.scope,
			state: request.state,
			codeChallenge: request.codeChallenge,
			resource: request.resource
		}
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals, platform, cookies, fetch }) => {
		const db = platform?.env.DB;
		if (!locals.user || !db) {
			throw redirect(303, loginHref(`${url.pathname}${url.search}`));
		}

		// SvelteKit already rejects cross-site form posts in production; the
		// consent decision is important enough to check again here regardless.
		const origin = request.headers.get('origin');
		if (origin !== url.origin) {
			return fail(403, { invalid: { code: 'invalid_request', message: 'Cross-site consent is not allowed' } });
		}

		const form = await request.formData();
		let parsed: AuthorizeRequest;
		try {
			parsed = await parseAuthorizeRequest(db, url.origin, form, fetch);
		} catch (error) {
			return fail(400, { invalid: handleAuthorizeError(url.origin, error) });
		}

		if (form.get('decision') !== 'allow') {
			throw redirect(
				303,
				redirectWith(url.origin, parsed.redirectUri, {
					error: 'access_denied',
					error_description: 'The user declined the request',
					state: parsed.state
				})
			);
		}

		// The person may authorize any account signed in on this browser, not just
		// the active one — but nothing else.
		let userId = locals.user.id;
		const chosen = param(form, 'user_id', 128);
		if (chosen && chosen !== locals.user.id) {
			const linked = await resolveLinkedSessions(db, readLinkedTokens(cookies));
			if (!linked.some((session) => session.user.id === chosen)) {
				return fail(400, {
					invalid: { code: 'invalid_request', message: 'That account is not signed in on this browser' }
				});
			}
			userId = chosen;
		}

		const code = await issueAuthorizationCode(db, {
			client_id: parsed.client.client_id,
			user_id: userId,
			redirect_uri: parsed.redirectUri,
			code_challenge: parsed.codeChallenge,
			scope: parsed.scope,
			resource: parsed.resource
		});

		throw redirect(303, redirectWith(url.origin, parsed.redirectUri, { code, state: parsed.state }));
	}
};
