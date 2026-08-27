import type { D1Database } from '@cloudflare/workers-types';
import { hashToken } from './crypto';
import type { ApiTokenSummary, User } from '$lib/types';

/** Scopes a token can carry. Enforced in `authorizeApiRequest`. */
export const API_SCOPES = ['mail:send', 'mail:read', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

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

export type ApiTokenAuth = {
	user: User;
	tokenId: string;
	scopes: ApiScope[];
};

const TOKEN_PREFIX = 'qm_live_';
const MAX_TOKEN_LENGTH = 256;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

function isPlausibleApiToken(token: string): boolean {
	return (
		token.startsWith(TOKEN_PREFIX) &&
		token.length > TOKEN_PREFIX.length &&
		token.length <= MAX_TOKEN_LENGTH
	);
}

export function isApiScope(value: unknown): value is ApiScope {
	return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

export function isValidScope(scopes: unknown): scopes is ApiScope[] {
	return parseScopes(scopes, true) !== null;
}

/** Deduped, known scopes. `admin` is rejected unless the owner is an admin. */
export function parseScopes(input: unknown, allowAdmin: boolean): ApiScope[] | null {
	if (!Array.isArray(input) || input.length === 0) return null;

	const scopes: ApiScope[] = [];
	for (const item of input) {
		if (!isApiScope(item)) return null;
		if (item === 'admin' && !allowAdmin) return null;
		if (!scopes.includes(item)) scopes.push(item);
	}

	return scopes;
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

/** Preview the random part, not the shared `qm_live_` prefix. */
export function previewFor(token: string): string {
	const random = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token;
	if (random.length < 8) return random;
	return `${random.slice(0, 4)}…${random.slice(-4)}`;
}

function parseStoredScopes(value: string): ApiScope[] {
	return value
		.split(',')
		.map((scope) => scope.trim())
		.filter(isApiScope);
}

function mapRow(row: TokenRow): ApiTokenSummary {
	return {
		id: row.id,
		name: row.name,
		preview: row.token_preview,
		scopes: parseStoredScopes(row.scopes),
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

	return (result.meta.changes ?? 0) > 0;
}

type TokenUserRow = {
	id: string;
	email: string;
	name: string;
	is_admin: number;
	created_at: string;
	token_id: string;
	scopes: string;
	last_used_at: string | null;
};

/**
 * Resolve a bearer token to its owning user. Returns null when the token is
 * unknown or already revoked.
 */
export async function getUserByApiToken(db: D1Database, token: string): Promise<ApiTokenAuth | null> {
	if (!isPlausibleApiToken(token)) return null;

	const hash = await hashToken(token);
	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
			        t.id AS token_id, t.scopes, t.last_used_at
			 FROM api_tokens t
			 JOIN users u ON u.id = t.user_id
			 WHERE t.token_hash = ?`
		)
		.bind(hash)
		.first<TokenUserRow>();

	if (!row) return null;

	const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
	if (!lastUsed || Date.now() - lastUsed >= LAST_USED_THROTTLE_MS) {
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
		scopes: parseStoredScopes(row.scopes)
	};
}

/** Read a `Bearer <token>` value off the Authorization header, if present. */
export function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	if (!match) return null;
	const token = match[1];
	if (token.length > MAX_TOKEN_LENGTH) return null;
	return token;
}
