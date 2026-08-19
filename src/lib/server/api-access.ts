import { API_SCOPES, type ApiScope } from './api-tokens';

export type { ApiScope };
export type AuthMethod = 'session' | 'api_token';

export type ApiAuthDecision = { ok: true } | { ok: false; status: number; error: string };

type RouteRule = {
	method: string;
	match: (pathname: string) => boolean;
	scopes: readonly ApiScope[];
};

function isPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const BEARER_ROUTES: RouteRule[] = [
	{
		method: 'GET',
		match: (pathname) => pathname === '/api/auth/me',
		scopes: API_SCOPES
	},
	{
		method: 'GET',
		match: (pathname) => pathname === '/api/mail',
		scopes: ['mail:read']
	},
	{
		method: 'POST',
		match: (pathname) => pathname === '/api/mail',
		scopes: ['mail:send']
	},
	{
		method: 'POST',
		match: (pathname) => pathname === '/api/mail/actions',
		scopes: ['mail:read', 'mail:send']
	},
	{
		method: 'GET',
		match: (pathname) => /^\/api\/mail\/[^/]+\/attachments\/[^/]+$/.test(pathname),
		scopes: ['mail:read']
	},
	{
		method: 'GET',
		match: (pathname) => /^\/api\/mail\/[^/]+$/.test(pathname),
		scopes: ['mail:read']
	},
	{
		method: 'POST',
		match: (pathname) => /^\/api\/mail\/[^/]+$/.test(pathname),
		scopes: ['mail:send']
	},
	{
		method: 'PATCH',
		match: (pathname) => /^\/api\/mail\/[^/]+$/.test(pathname),
		scopes: ['mail:send']
	},
	{
		method: 'DELETE',
		match: (pathname) => /^\/api\/mail\/[^/]+$/.test(pathname),
		scopes: ['mail:send']
	},
	{
		method: 'GET',
		match: (pathname) => pathname === '/api/addresses',
		scopes: ['mail:read', 'mail:send', 'admin']
	},
	{
		method: 'POST',
		match: (pathname) => pathname === '/api/addresses',
		scopes: ['admin']
	},
	{
		method: 'PATCH',
		match: (pathname) => /^\/api\/addresses\/[^/]+$/.test(pathname),
		scopes: ['admin']
	},
	{
		method: 'DELETE',
		match: (pathname) => /^\/api\/addresses\/[^/]+$/.test(pathname),
		scopes: ['admin']
	},
	{
		method: 'GET',
		match: (pathname) => isPrefix(pathname, '/api/admin'),
		scopes: ['admin']
	},
	{
		method: 'POST',
		match: (pathname) => isPrefix(pathname, '/api/admin'),
		scopes: ['admin']
	},
	{
		method: 'PATCH',
		match: (pathname) => isPrefix(pathname, '/api/admin'),
		scopes: ['admin']
	},
	{
		method: 'DELETE',
		match: (pathname) => isPrefix(pathname, '/api/admin'),
		scopes: ['admin']
	},
	{
		method: 'GET',
		match: (pathname) => isPrefix(pathname, '/api/domains'),
		scopes: ['admin']
	},
	{
		method: 'POST',
		match: (pathname) => isPrefix(pathname, '/api/domains'),
		scopes: ['admin']
	},
	{
		method: 'PATCH',
		match: (pathname) => isPrefix(pathname, '/api/domains'),
		scopes: ['admin']
	},
	{
		method: 'DELETE',
		match: (pathname) => isPrefix(pathname, '/api/domains'),
		scopes: ['admin']
	}
];

/** Bulk mailbox actions. Per-action scopes are enforced in `authorizeMailAction`. */
export const MAIL_ACTIONS = [
	'read',
	'unread',
	'star',
	'unstar',
	'trash',
	'restore',
	'delete',
	'read-all',
	'empty-trash'
] as const;

export type MailAction = (typeof MAIL_ACTIONS)[number];

export function isMailAction(value: unknown): value is MailAction {
	return typeof value === 'string' && (MAIL_ACTIONS as readonly string[]).includes(value);
}

function hasScope(granted: readonly ApiScope[], needed: readonly ApiScope[]): boolean {
	return needed.some((scope) => granted.includes(scope));
}

function hasAllScopes(granted: readonly ApiScope[], needed: readonly ApiScope[]): boolean {
	return needed.every((scope) => granted.includes(scope));
}

/**
 * Session cookies may run any mailbox action. API keys: flag changes need
 * `mail:read`; destructive / whole-mailbox actions need both `mail:read` and
 * `mail:send` so a send-only cron key cannot wipe the mailbox.
 */
export function authorizeMailAction(input: {
	action: MailAction;
	authMethod: AuthMethod;
	scopes: readonly ApiScope[];
}): ApiAuthDecision {
	if (input.authMethod === 'session') {
		return { ok: true };
	}

	switch (input.action) {
		case 'read':
		case 'unread':
		case 'star':
		case 'unstar':
			if (!input.scopes.includes('mail:read')) {
				return { ok: false, status: 403, error: 'This API key needs mail:read.' };
			}
			return { ok: true };
		case 'trash':
		case 'restore':
		case 'delete':
		case 'read-all':
		case 'empty-trash':
			if (!hasAllScopes(input.scopes, ['mail:read', 'mail:send'])) {
				return {
					ok: false,
					status: 403,
					error: 'This API key needs mail:read and mail:send.'
				};
			}
			return { ok: true };
		default: {
			const _never: never = input.action;
			return _never;
		}
	}
}

/**
 * Session cookies keep full access. Bearer tokens are limited to an explicit
 * allowlist so a leaked "read" key cannot send mail, mint more keys, or hit
 * admin routes.
 */
export function authorizeApiRequest(input: {
	pathname: string;
	method: string;
	authMethod: AuthMethod;
	scopes: readonly ApiScope[];
}): ApiAuthDecision {
	if (input.authMethod === 'session') {
		return { ok: true };
	}

	if (isPrefix(input.pathname, '/api/apikeys')) {
		return {
			ok: false,
			status: 403,
			error: 'API keys cannot manage API keys. Sign in with a browser session.'
		};
	}

	const method = input.method.toUpperCase();
	const rule = BEARER_ROUTES.find((entry) => entry.method === method && entry.match(input.pathname));
	if (!rule) {
		return {
			ok: false,
			status: 403,
			error: 'This API key cannot access that endpoint.'
		};
	}

	if (!hasScope(input.scopes, rule.scopes)) {
		return {
			ok: false,
			status: 403,
			error: `This API key needs ${rule.scopes.join(' or ')}.`
		};
	}

	return { ok: true };
}
