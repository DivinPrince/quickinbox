import type { D1Database } from '@cloudflare/workers-types';
import { hashToken } from './crypto';
import type { ApiTokenSummary, User } from '$lib/types';

/** Scopes a token can carry. For now every scope acts as the owning user. */
export const API_SCOPES = ['mail:send', 'mail:read'] as const;
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
	return `qm_live_${toBase64Url(bytes)}`;
}

/** A masked fragment (first 8 + last 4 chars) to tell tokens apart in the UI. */
function previewFor(token: string): string {
	return token.length > 14 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token.slice(0, 8);
}

function mapRow(row: TokenRow): ApiTokenSummary {
	return {
		id: row.id,
		name: row.name,
		preview: row.token_preview,
		scopes: (row.scopes.split(',') as ApiScope[]).filter((scope) =>
			API_SCOPES.includes(scope)
		),
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
};

/**
 * Resolve a bearer token to its owning user. A session-independent login that
 * scripts can use: it never rolls over and can be revoked by deleting the token.
 * Returns null when the token is unknown or already deleted.
 */
export async function getUserByApiToken(
	db: D1Database,
	token: string
): Promise<(User & { tokenId: string }) | null> {
	if (!token.startsWith('qm_live_')) return null;
	const hash = await hashToken(token);

	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.is_admin, u.created_at, t.id AS token_id
			 FROM api_tokens t
			 JOIN users u ON u.id = t.user_id
			 WHERE t.token_hash = ?`
		)
		.bind(hash)
		.first<TokenUserRow>();

	if (!row) return null;

	// Refresh the last-use marker opportunistically; a missed update is harmless.
	await db
		.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
		.bind(new Date().toISOString(), row.token_id)
		.run();

	return {
		id: row.id,
		email: row.email,
		name: row.name,
		is_admin: row.is_admin === 1,
		created_at: row.created_at,
		tokenId: row.token_id
	};
}

/** Read a `Bearer <token>` value off the Authorization header, if present. */
export function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : null;
}