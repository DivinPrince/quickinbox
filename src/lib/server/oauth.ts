import type { D1Database } from '@cloudflare/workers-types';
import { hashToken } from './crypto';
import type { ApiScope } from './api-tokens';
import type { ConnectedApp, User } from '$lib/types';

/**
 * OAuth 2.1 authorization server for the hosted MCP endpoint.
 *
 * Flow (all per the MCP authorization spec): the client discovers
 * `/.well-known/oauth-protected-resource/mcp` from a 401 on `/mcp`, reads the
 * authorization server metadata, registers itself, sends the user to
 * `/oauth/authorize` with PKCE, and exchanges the code at `/oauth/token`.
 *
 * Tokens are opaque random strings; only SHA-256 hashes hit D1, the same as
 * sessions and API keys. That keeps revocation instant and needs no signing key.
 */

export const OAUTH_SCOPES = ['mail:read', 'mail:send'] as const satisfies readonly ApiScope[];
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
/** Metadata documents are re-fetched after this long. */
const CLIENT_METADATA_TTL_MS = 60 * 60 * 1000;
const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const CLIENT_METADATA_TIMEOUT_MS = 5000;

const ACCESS_TOKEN_PREFIX = 'qi_mcp_';
const REFRESH_TOKEN_PREFIX = 'qi_rt_';
const MAX_TOKEN_LENGTH = 256;
const MAX_REDIRECT_URIS = 10;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export class OAuthError extends Error {
	constructor(
		readonly code: string,
		description: string,
		readonly status = 400
	) {
		super(description);
		this.name = 'OAuthError';
	}

	toJSON() {
		return { error: this.code, error_description: this.message };
	}
}

// ---- Discovery ------------------------------------------------------------

export function mcpResourceUri(origin: string): string {
	return `${origin}/mcp`;
}

export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		revocation_endpoint: `${origin}/oauth/revoke`,
		scopes_supported: [...OAUTH_SCOPES],
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		code_challenge_methods_supported: ['S256'],
		client_id_metadata_document_supported: true,
		authorization_response_iss_parameter_supported: true,
		service_documentation: `${origin}/settings/connections`
	};
}

export function protectedResourceMetadata(origin: string) {
	return {
		resource: mcpResourceUri(origin),
		authorization_servers: [origin],
		scopes_supported: [...OAUTH_SCOPES],
		bearer_methods_supported: ['header'],
		resource_name: 'Quickinbox MCP',
		resource_documentation: `${origin}/settings/connections`
	};
}

// ---- Scopes -----------------------------------------------------------------

export function isOAuthScope(value: unknown): value is OAuthScope {
	return typeof value === 'string' && (OAUTH_SCOPES as readonly string[]).includes(value);
}

/**
 * Space-separated scope string → known scopes. Empty means "everything we
 * offer"; a request naming only unknown scopes is an error rather than a
 * silently different grant.
 */
export function normalizeScope(input: string | null | undefined): OAuthScope[] {
	const requested = (input ?? '').split(/\s+/).filter(Boolean);
	if (requested.length === 0) return [...OAUTH_SCOPES];
	const scopes = OAUTH_SCOPES.filter((scope) => requested.includes(scope));
	if (scopes.length === 0) {
		throw new OAuthError('invalid_scope', `Supported scopes: ${OAUTH_SCOPES.join(' ')}`);
	}
	return [...scopes];
}

export function parseStoredScope(value: string): OAuthScope[] {
	return value.split(' ').filter(isOAuthScope);
}

// ---- Redirect URIs ----------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes a browser would execute or read local files with — never a callback. */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:', 'ws:', 'wss:', 'ftp:']);

/**
 * https, http on loopback, or a private-use scheme (RFC 8252). Desktop clients
 * use custom schemes like `cursor://…`, so anything that is not web or one of
 * the dangerous built-ins is allowed.
 */
export function isAllowedRedirectUri(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (url.protocol === 'https:') return url.hostname.length > 0;
	if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
	if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
	return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol);
}

/** Exact match, except loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string[], requested: string): boolean {
	if (registered.includes(requested)) return true;
	let wanted: URL;
	try {
		wanted = new URL(requested);
	} catch {
		return false;
	}
	if (wanted.protocol !== 'http:' || !LOOPBACK_HOSTS.has(wanted.hostname)) return false;
	return registered.some((entry) => {
		try {
			const known = new URL(entry);
			return (
				known.protocol === 'http:' &&
				LOOPBACK_HOSTS.has(known.hostname) &&
				known.hostname === wanted.hostname &&
				known.pathname === wanted.pathname &&
				known.search === wanted.search
			);
		} catch {
			return false;
		}
	});
}

// ---- Clients ----------------------------------------------------------------

export type OAuthClient = {
	client_id: string;
	client_name: string;
	client_uri: string | null;
	logo_uri: string | null;
	redirect_uris: string[];
	created_at: string;
};

type ClientRow = Omit<OAuthClient, 'redirect_uris'> & { redirect_uris: string; fetched_at: string | null };

function mapClient(row: ClientRow): OAuthClient {
	let uris: unknown;
	try {
		uris = JSON.parse(row.redirect_uris);
	} catch {
		uris = [];
	}
	return {
		client_id: row.client_id,
		client_name: row.client_name,
		client_uri: row.client_uri,
		logo_uri: row.logo_uri,
		redirect_uris: Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : [],
		created_at: row.created_at
	};
}

function httpsOrNull(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 2048) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

function cleanName(value: unknown, fallback: string): string {
	const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim() : '';
	return (name || fallback).slice(0, 100);
}

/** Validate RFC 7591 client metadata. Shared by registration and metadata documents. */
export function parseClientMetadata(input: unknown): Omit<OAuthClient, 'client_id' | 'created_at'> {
	if (typeof input !== 'object' || input === null) {
		throw new OAuthError('invalid_client_metadata', 'Client metadata must be a JSON object');
	}
	const meta = input as Record<string, unknown>;

	if (!Array.isArray(meta.redirect_uris) || meta.redirect_uris.length === 0) {
		throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array');
	}
	if (meta.redirect_uris.length > MAX_REDIRECT_URIS) {
		throw new OAuthError('invalid_redirect_uri', `At most ${MAX_REDIRECT_URIS} redirect_uris`);
	}
	const redirectUris: string[] = [];
	for (const uri of meta.redirect_uris) {
		if (typeof uri !== 'string' || uri.length > 2048 || !isAllowedRedirectUri(uri)) {
			throw new OAuthError(
				'invalid_redirect_uri',
				'redirect_uris must be https URLs, http://localhost URLs, or private-use scheme URIs'
			);
		}
		if (!redirectUris.includes(uri)) redirectUris.push(uri);
	}

	if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none') {
		throw new OAuthError(
			'invalid_client_metadata',
			'Only public clients are supported (token_endpoint_auth_method: none)'
		);
	}
	if (Array.isArray(meta.grant_types)) {
		for (const grant of meta.grant_types) {
			if (grant !== 'authorization_code' && grant !== 'refresh_token') {
				throw new OAuthError('invalid_client_metadata', `Unsupported grant_type ${String(grant)}`);
			}
		}
	}
	if (Array.isArray(meta.response_types)) {
		for (const type of meta.response_types) {
			if (type !== 'code') {
				throw new OAuthError('invalid_client_metadata', `Unsupported response_type ${String(type)}`);
			}
		}
	}

	const clientUri = httpsOrNull(meta.client_uri);
	const fallbackName = clientUri ? new URL(clientUri).hostname : new URL(redirectUris[0]).hostname || 'MCP client';
	return {
		client_name: cleanName(meta.client_name, fallbackName),
		client_uri: clientUri,
		logo_uri: httpsOrNull(meta.logo_uri),
		redirect_uris: redirectUris
	};
}

function randomToken(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return `${prefix}${toBase64Url(bytes)}`;
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7591 dynamic registration. Returns the stored client plus the response body. */
export async function registerClient(db: D1Database, input: unknown): Promise<OAuthClient> {
	const meta = parseClientMetadata(input);
	const client: OAuthClient = {
		client_id: randomToken('qi_client_'),
		created_at: new Date().toISOString(),
		...meta
	};
	await db
		.prepare(
			`INSERT INTO oauth_clients (client_id, client_name, client_uri, logo_uri, redirect_uris, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			client.client_id,
			client.client_name,
			client.client_uri,
			client.logo_uri,
			JSON.stringify(client.redirect_uris),
			client.created_at
		)
		.run();
	return client;
}

export function registrationResponse(client: OAuthClient) {
	return {
		client_id: client.client_id,
		client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
		client_name: client.client_name,
		client_uri: client.client_uri ?? undefined,
		logo_uri: client.logo_uri ?? undefined,
		redirect_uris: client.redirect_uris,
		token_endpoint_auth_method: 'none',
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code']
	};
}

/** A client_id that is itself an https URL points at a Client ID Metadata Document. */
export function isClientMetadataUrl(clientId: string): boolean {
	try {
		const url = new URL(clientId);
		return (
			url.protocol === 'https:' &&
			url.pathname.length > 1 &&
			!url.username &&
			!url.password &&
			!isBlockedMetadataHost(url.hostname)
		);
	} catch {
		return false;
	}
}

/** Loopback, RFC1918, link-local, and metadata hosts must not be fetched as client documents. */
export function isBlockedMetadataHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	) {
		return true;
	}
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
		const parts = host.split('.').map(Number);
		if (parts.some((octet) => octet > 255)) return true;
		const [a, b] = parts;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 192 && b === 168) ||
			(a === 172 && b >= 16 && b <= 31)
		);
	}
	if (host.includes(':')) {
		return (
			host === '::1' ||
			host === '::' ||
			host.startsWith('fe80:') ||
			host.startsWith('fc') ||
			host.startsWith('fd') ||
			host.startsWith('::ffff:')
		);
	}
	return false;
}

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new OAuthError('invalid_client', 'Client metadata document is too large', 401);
	}
	const reader = response.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new OAuthError('invalid_client', 'Client metadata document is too large', 401);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

async function fetchClientMetadataDocument(
	clientId: string,
	fetchImpl: typeof fetch
): Promise<Omit<OAuthClient, 'client_id' | 'created_at'>> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CLIENT_METADATA_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetchImpl(clientId, {
			headers: { accept: 'application/json' },
			redirect: 'error',
			signal: controller.signal
		});
	} catch {
		throw new OAuthError('invalid_client', 'Could not fetch the client metadata document', 401);
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		throw new OAuthError('invalid_client', 'Client metadata document is unavailable', 401);
	}
	const text = await readCappedText(response, CLIENT_METADATA_MAX_BYTES);
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		throw new OAuthError('invalid_client', 'Client metadata document is not JSON', 401);
	}
	if (typeof doc !== 'object' || doc === null || (doc as { client_id?: unknown }).client_id !== clientId) {
		throw new OAuthError('invalid_client', 'Client metadata document client_id does not match', 401);
	}
	try {
		return parseClientMetadata(doc);
	} catch (error) {
		if (error instanceof OAuthError) throw new OAuthError('invalid_client', error.message, 401);
		throw error;
	}
}

/**
 * Look a client up. Registered clients come straight from D1; metadata-document
 * clients are fetched on first use and refreshed hourly.
 */
export async function getClient(
	db: D1Database,
	clientId: string,
	fetchImpl: typeof fetch = fetch
): Promise<OAuthClient | null> {
	if (!clientId || clientId.length > 2048) return null;
	const row = await db
		.prepare(
			'SELECT client_id, client_name, client_uri, logo_uri, redirect_uris, created_at, fetched_at FROM oauth_clients WHERE client_id = ?'
		)
		.bind(clientId)
		.first<ClientRow>();

	const fresh =
		row && (!row.fetched_at || Date.now() - Date.parse(row.fetched_at) < CLIENT_METADATA_TTL_MS);
	if (row && fresh) return mapClient(row);
	if (!isClientMetadataUrl(clientId)) return row ? mapClient(row) : null;

	let meta: Omit<OAuthClient, 'client_id' | 'created_at'>;
	try {
		meta = await fetchClientMetadataDocument(clientId, fetchImpl);
	} catch (error) {
		// A stale copy beats failing the login because the client's CDN hiccuped.
		if (row) return mapClient(row);
		throw error;
	}
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO oauth_clients (client_id, client_name, client_uri, logo_uri, redirect_uris, created_at, fetched_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(client_id) DO UPDATE SET
				client_name = excluded.client_name,
				client_uri = excluded.client_uri,
				logo_uri = excluded.logo_uri,
				redirect_uris = excluded.redirect_uris,
				fetched_at = excluded.fetched_at`
		)
		.bind(clientId, meta.client_name, meta.client_uri, meta.logo_uri, JSON.stringify(meta.redirect_uris), row?.created_at ?? now, now)
		.run();
	return { client_id: clientId, created_at: row?.created_at ?? now, ...meta };
}

// ---- PKCE -------------------------------------------------------------------

export function isValidCodeChallenge(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

export function isValidCodeVerifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

async function s256(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return toBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
	return constantTimeEqual(await s256(verifier), challenge);
}

// ---- Authorization codes ----------------------------------------------------

export type AuthorizationCode = {
	client_id: string;
	user_id: string;
	redirect_uri: string;
	code_challenge: string;
	scope: OAuthScope[];
	resource: string;
};

export async function issueAuthorizationCode(
	db: D1Database,
	input: AuthorizationCode
): Promise<string> {
	const code = randomToken('qi_code_');
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			await hashToken(code),
			input.client_id,
			input.user_id,
			input.redirect_uri,
			input.code_challenge,
			input.scope.join(' '),
			input.resource,
			new Date(now + AUTH_CODE_TTL_MS).toISOString(),
			new Date(now).toISOString()
		)
		.run();
	return code;
}

type CodeRow = {
	code_hash: string;
	client_id: string;
	user_id: string;
	redirect_uri: string;
	code_challenge: string;
	scope: string;
	resource: string;
	expires_at: string;
};

/**
 * Delete-and-return makes the code single-use even under concurrent exchange:
 * only the request whose DELETE removed the row gets it back.
 */
export async function consumeAuthorizationCode(
	db: D1Database,
	code: string
): Promise<AuthorizationCode | null> {
	if (!code || code.length > MAX_TOKEN_LENGTH) return null;
	const hash = await hashToken(code);
	const row = await db
		.prepare(
			`DELETE FROM oauth_codes WHERE code_hash = ?
			 RETURNING code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at`
		)
		.bind(hash)
		.first<CodeRow>();
	if (!row) return null;
	if (Date.parse(row.expires_at) <= Date.now()) return null;
	return {
		client_id: row.client_id,
		user_id: row.user_id,
		redirect_uri: row.redirect_uri,
		code_challenge: row.code_challenge,
		scope: parseStoredScope(row.scope),
		resource: row.resource
	};
}

/** Housekeeping: expired codes are worthless, so drop them opportunistically. */
export async function deleteExpiredCodes(db: D1Database): Promise<void> {
	await db.prepare('DELETE FROM oauth_codes WHERE datetime(expires_at) <= datetime(?)').bind(new Date().toISOString()).run();
}

// ---- Tokens -----------------------------------------------------------------

export type TokenResponse = {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token: string;
	scope: string;
};

async function insertGrant(
	db: D1Database,
	input: { clientId: string; userId: string; scope: OAuthScope[]; resource: string; familyId: string }
): Promise<TokenResponse> {
	const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
	const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO oauth_grants
			 (id, family_id, client_id, user_id, scope, resource, access_hash, refresh_hash, access_expires_at, refresh_expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.familyId,
			input.clientId,
			input.userId,
			input.scope.join(' '),
			input.resource,
			await hashToken(accessToken),
			await hashToken(refreshToken),
			new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
			new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
			new Date(now).toISOString()
		)
		.run();
	return {
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
		refresh_token: refreshToken,
		scope: input.scope.join(' ')
	};
}

/** First tokens for an approved authorization code. */
export async function issueGrant(
	db: D1Database,
	input: { clientId: string; userId: string; scope: OAuthScope[]; resource: string }
): Promise<TokenResponse> {
	return insertGrant(db, { ...input, familyId: crypto.randomUUID() });
}

type GrantRow = {
	id: string;
	family_id: string;
	client_id: string;
	user_id: string;
	scope: string;
	resource: string;
	refresh_expires_at: string;
	revoked_at: string | null;
};

/**
 * Rotate a refresh token. Presenting one that was already rotated is treated
 * as theft: every token in its family is revoked and the request fails.
 */
export async function refreshGrant(
	db: D1Database,
	input: { refreshToken: string; clientId: string; scope?: string | null }
): Promise<TokenResponse> {
	if (!input.refreshToken.startsWith(REFRESH_TOKEN_PREFIX) || input.refreshToken.length > MAX_TOKEN_LENGTH) {
		throw new OAuthError('invalid_grant', 'Unknown refresh token');
	}
	const hash = await hashToken(input.refreshToken);
	const row = await db
		.prepare(
			`SELECT id, family_id, client_id, user_id, scope, resource, refresh_expires_at, revoked_at
			 FROM oauth_grants WHERE refresh_hash = ?`
		)
		.bind(hash)
		.first<GrantRow>();
	if (!row) throw new OAuthError('invalid_grant', 'Unknown refresh token');
	if (row.client_id !== input.clientId) {
		throw new OAuthError('invalid_grant', 'Refresh token was issued to a different client');
	}
	if (row.revoked_at) {
		await revokeFamily(db, row.family_id);
		throw new OAuthError('invalid_grant', 'Refresh token was already used; all tokens for this login were revoked');
	}
	if (Date.parse(row.refresh_expires_at) <= Date.now()) {
		throw new OAuthError('invalid_grant', 'Refresh token has expired');
	}

	const granted = parseStoredScope(row.scope);
	let scope = granted;
	if (input.scope) {
		const requested = normalizeScope(input.scope);
		if (requested.some((entry) => !granted.includes(entry))) {
			throw new OAuthError('invalid_scope', 'A refresh may narrow the scope but not widen it');
		}
		scope = requested;
	}

	// Revoke-then-insert: the old token stops working the instant the new one
	// exists, and a lost response leaves the client with nothing usable, which
	// is the safe failure.
	const revoked = await db
		.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
		.bind(new Date().toISOString(), row.id)
		.run();
	if ((revoked.meta.changes ?? 0) === 0) {
		await revokeFamily(db, row.family_id);
		throw new OAuthError('invalid_grant', 'Refresh token was already used; all tokens for this login were revoked');
	}
	return insertGrant(db, {
		clientId: row.client_id,
		userId: row.user_id,
		scope,
		resource: row.resource,
		familyId: row.family_id
	});
}

async function revokeFamily(db: D1Database, familyId: string): Promise<void> {
	await db
		.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
		.bind(new Date().toISOString(), familyId)
		.run();
}

/**
 * RFC 7009. Either token of a pair revokes the whole family — an access token
 * without its refresh token is not a meaningful thing to keep alive.
 * Unknown tokens succeed silently, as the RFC requires.
 */
export async function revokeToken(db: D1Database, token: string, clientId?: string | null): Promise<void> {
	if (!token || token.length > MAX_TOKEN_LENGTH) return;
	const hash = await hashToken(token);
	const row = await db
		.prepare('SELECT family_id, client_id FROM oauth_grants WHERE access_hash = ? OR refresh_hash = ?')
		.bind(hash, hash)
		.first<{ family_id: string; client_id: string }>();
	if (!row) return;
	if (clientId && row.client_id !== clientId) return;
	await revokeFamily(db, row.family_id);
}

export type OAuthTokenAuth = {
	user: User;
	scopes: OAuthScope[];
	grantId: string;
	clientId: string;
};

type TokenUserRow = {
	grant_id: string;
	client_id: string;
	scope: string;
	access_expires_at: string;
	revoked_at: string | null;
	last_used_at: string | null;
	id: string;
	email: string;
	name: string;
	is_admin: number;
	must_change_password: number;
	created_at: string;
};

/** Resolve an MCP bearer token to its user. Null for unknown, expired, or revoked tokens. */
export async function getUserByOAuthToken(db: D1Database, token: string): Promise<OAuthTokenAuth | null> {
	if (!token.startsWith(ACCESS_TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
	const hash = await hashToken(token);
	const row = await db
		.prepare(
			`SELECT g.id AS grant_id, g.client_id, g.scope, g.access_expires_at, g.revoked_at, g.last_used_at,
			        u.id, u.email, u.name, u.is_admin, u.must_change_password, u.created_at
			 FROM oauth_grants g JOIN users u ON u.id = g.user_id
			 WHERE g.access_hash = ?`
		)
		.bind(hash)
		.first<TokenUserRow>();
	if (!row || row.revoked_at || row.must_change_password === 1) return null;
	if (Date.parse(row.access_expires_at) <= Date.now()) return null;

	const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
	if (!lastUsed || Date.now() - lastUsed >= LAST_USED_THROTTLE_MS) {
		await db
			.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?')
			.bind(new Date().toISOString(), row.grant_id)
			.run();
	}

	return {
		user: {
			id: row.id,
			email: row.email,
			name: row.name,
			is_admin: row.is_admin === 1,
			must_change_password: row.must_change_password === 1,
			created_at: row.created_at
		},
		scopes: parseStoredScope(row.scope),
		grantId: row.grant_id,
		clientId: row.client_id
	};
}

// ---- Connected apps (Settings) --------------------------------------------------

type ConnectedAppRow = {
	client_id: string;
	client_name: string | null;
	client_uri: string | null;
	logo_uri: string | null;
	scopes: string;
	sessions: number;
	connected_at: string;
	last_used_at: string | null;
};

export async function listConnectedApps(db: D1Database, userId: string): Promise<ConnectedApp[]> {
	const { results } = await db
		.prepare(
			`SELECT g.client_id, c.client_name, c.client_uri, c.logo_uri,
			        group_concat(DISTINCT g.scope) AS scopes,
			        COUNT(*) AS sessions,
			        MIN(g.created_at) AS connected_at,
			        MAX(g.last_used_at) AS last_used_at
			 FROM oauth_grants g
			 LEFT JOIN oauth_clients c ON c.client_id = g.client_id
			 WHERE g.user_id = ? AND g.revoked_at IS NULL AND datetime(g.refresh_expires_at) > datetime(?)
			 GROUP BY g.client_id
			 ORDER BY MAX(COALESCE(g.last_used_at, g.created_at)) DESC`
		)
		.bind(userId, new Date().toISOString())
		.all<ConnectedAppRow>();

	return results.map((row) => ({
		client_id: row.client_id,
		client_name: row.client_name ?? clientNameFromId(row.client_id),
		client_uri: row.client_uri,
		logo_uri: row.logo_uri,
		scopes: OAUTH_SCOPES.filter((scope) => row.scopes.split(/[ ,]/).includes(scope)),
		sessions: row.sessions,
		connected_at: row.connected_at,
		last_used_at: row.last_used_at
	}));
}

function clientNameFromId(clientId: string): string {
	try {
		return new URL(clientId).hostname;
	} catch {
		return 'MCP client';
	}
}

/** Disconnect an app: every live token this user issued to the client. */
export async function revokeClientForUser(db: D1Database, userId: string, clientId: string): Promise<number> {
	const result = await db
		.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
		.bind(new Date().toISOString(), userId, clientId)
		.run();
	return result.meta.changes ?? 0;
}

// ---- Bearer challenge -------------------------------------------------------------

/** `WWW-Authenticate` value that points clients at the resource metadata (RFC 9728). */
export function bearerChallenge(
	origin: string,
	extra?: { error: string; description: string }
): string {
	const params = [
		...(extra ? [`error="${extra.error}"`, `error_description="${extra.description.replaceAll('"', "'")}"`] : []),
		`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
		`scope="${OAUTH_SCOPES.join(' ')}"`
	];
	return `Bearer ${params.join(', ')}`;
}
