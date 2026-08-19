import type { D1Database } from '@cloudflare/workers-types';
import { hashToken } from './crypto';
import type { ApiTokenSummary, User } from '$lib/types';

/** Scopes a token can carry. Both are enforced -- see `tokenAllows`. */
export const API_SCOPES = ['mail:send', 'mail:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const TOKEN_PREFIX = 'qm_live_';

/**
 * How stale `last_used_at` is allowed to get. Without this every scripted send
 * costs a second D1 write purely for a timestamp nobody reads that precisely.
 */
const LAST_USED_THROTTLE_MS = 15 * 60 * 1000;

type TokenRow = {
	id: string;
	user_id: string;
	name: string;
	token_preview: string;
	scopes: string;
	created_at: string;
	last_used_at: string | null;
};

/** A freshly minted token: the raw value (shown once) plus its stored summary. */
export type CreatedApiToken = {
	token: string;
	summary: ApiTokenSummary;
};

export function isValidScope(scopes: unknown): scopes is ApiScope[] {
	return (
		Array.isArray(scopes) &&
		scopes.length > 0 &&
		scopes.every((scope) => API_SCOPES.includes(scope as ApiScope))
	);
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `qm_live_<32 random bytes, base64url>` — recognizable and collision-resistant. */
function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return `${TOKEN_PREFIX}${toBase64Url(bytes)}`;
}

/**
 * A masked fragment used to tell keys apart in the list. Taken from the random
 * part only -- every token starts with the same prefix, so including it made
 * every preview look identical.
 */
function previewFor(token: string): string {
	const random = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token;
	if (random.length <= 8) return random;
	return `${random.slice(0, 4)}…${random.slice(-4)}`;
}

function parseScopes(raw: string): ApiScope[] {
	return (raw.split(',') as ApiScope[]).filter((scope) => API_SCOPES.includes(scope));
}

function mapRow(row: TokenRow): ApiTokenSummary {
	return {
		id: row.id,
		name: row.name,
		preview: row.token_preview,
		scopes: parseScopes(row.scopes),
		created_at: row.created_at,
		last_used_at: row.last_used_at
	};
}

export async function createApiToken(
	db: D1Database,
	userId: string,
	options: { name?: string; scopes?: ApiScope[] } = {}
): Promise<CreatedApiToken> {
	const token = generateToken();
	const hash = await hashToken(token);
	const id = crypto.randomUUID();
	const scopes: ApiScope[] = options.scopes?.length ? options.scopes : ['mail:send'];
	const name = (options.name ?? '').trim().slice(0, 60) || 'Default';
	const createdAt = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO api_tokens (id, user_id, name, token_hash, token_preview, scopes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(id, userId, name, hash, previewFor(token), scopes.join(','), createdAt)
		.run();

	return {
		token,
		summary: {
			id,
			name,
			preview: previewFor(token),
			scopes,
			created_at: createdAt,
			last_used_at: null
		}
	};
}

export async function listApiTokens(db: D1Database, userId: string): Promise<ApiTokenSummary[]> {
	const { results } = await db
		.prepare(
			`SELECT id, user_id, name, token_preview, scopes, created_at, last_used_at
			 FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`
		)
		.bind(userId)
		.all<TokenRow>();
	return results.map(mapRow);
}

export async function revokeApiToken(
	db: D1Database,
	userId: string,
	tokenId: string
): Promise<boolean> {
	const result = await db
		.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?')
		.bind(tokenId, userId)
		.run();
	return Boolean(result.meta.changes > 0);
}

type TokenUserRow = {
	id: string;
	email: string;
	name: string;
	is_admin: number;
	created_at: string;
	token_id: string;
	token_scopes: string;
	token_last_used_at: string | null;
};

/** What a verified bearer token resolves to: who, plus what it may do. */
export type ApiTokenIdentity = {
	user: User;
	tokenId: string;
	scopes: ApiScope[];
};

/** Does this request's credential carry the scope a route requires? */
export function tokenAllows(scopes: ApiScope[] | null, required: ApiScope): boolean {
	// A browser session has no token and is not scope-limited.
	if (scopes === null) return true;
	return scopes.includes(required);
}

/**
 * Resolve a bearer token to its owning user. A session-independent login that
 * scripts can use: it never rolls over and can be revoked by deleting the token.
 * Returns null when the token is unknown or already deleted.
 */
export async function getUserByApiToken(
	db: D1Database,
	token: string
): Promise<ApiTokenIdentity | null> {
	if (!token.startsWith(TOKEN_PREFIX)) return null;
	const hash = await hashToken(token);

	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
			        t.id AS token_id, t.scopes AS token_scopes,
			        t.last_used_at AS token_last_used_at
			 FROM api_tokens t
			 JOIN users u ON u.id = t.user_id
			 WHERE t.token_hash = ?`
		)
		.bind(hash)
		.first<TokenUserRow>();

	if (!row) return null;

	// Only refresh the marker once it has actually gone stale. A scripted sender
	// hits this on every request, and the timestamp is not read at that precision.
	const lastUsed = row.token_last_used_at ? Date.parse(row.token_last_used_at) : 0;
	if (!Number.isFinite(lastUsed) || Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
		await db
			.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
			.bind(new Date().toISOString(), row.token_id)
			.run();
	}

	return {
		user: {
			id: row.id,
			email: row.email,
			name: row.name,
			is_admin: row.is_admin === 1,
			created_at: row.created_at
		},
		tokenId: row.token_id,
		scopes: parseScopes(row.token_scopes)
	};
}

/** Read a `Bearer <token>` value off the Authorization header, if present. */
export function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : null;
}