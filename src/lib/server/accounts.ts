import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import { sessionCookieOptions } from './auth';
import { LINKED_SESSIONS_COOKIE, MAX_LINKED_ACCOUNTS, SESSION_DAYS } from './constants';
import { hashToken } from './crypto';
import type { LinkedAccount, User } from '$lib/types';

/**
 * Multiple accounts in one browser.
 *
 * Each account is an ordinary browser session row. The active one lives in
 * `SESSION_COOKIE` exactly as before; the others are parked in
 * `LINKED_SESSIONS_COOKIE` and swapped in on switch. Nothing below the hooks
 * layer knows more than one user exists.
 */

export type ResolvedSession = {
	token: string;
	sessionId: string;
	user: User;
	/** Default sending address, for the switcher label. */
	address: string | null;
};

type SessionRow = {
	token_hash: string;
	session_id: string;
	id: string;
	email: string;
	name: string;
	is_admin: number;
	must_change_password: number;
	created_at: string;
	address: string | null;
};

/** Cookie → tokens. Tolerates garbage, dedupes, and caps the count. */
export function parseLinkedTokens(raw: string | undefined): string[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const tokens: string[] = [];
	for (const value of parsed) {
		if (typeof value !== 'string' || value.length === 0 || value.length > 128) continue;
		if (tokens.includes(value)) continue;
		tokens.push(value);
		if (tokens.length >= MAX_LINKED_ACCOUNTS) break;
	}
	return tokens;
}

export function serializeLinkedTokens(tokens: string[]): string {
	return JSON.stringify(tokens.slice(0, MAX_LINKED_ACCOUNTS));
}

export function readLinkedTokens(cookies: Pick<Cookies, 'get'>): string[] {
	return parseLinkedTokens(cookies.get(LINKED_SESSIONS_COOKIE));
}

/** Persist the parked tokens; an empty list removes the cookie. */
export function writeLinkedTokens(
	cookies: Pick<Cookies, 'set' | 'delete'>,
	tokens: string[],
	url: URL
): void {
	const unique = tokens.filter((token, index) => token && tokens.indexOf(token) === index);
	if (unique.length === 0) {
		cookies.delete(LINKED_SESSIONS_COOKIE, { path: '/' });
		return;
	}
	cookies.set(
		LINKED_SESSIONS_COOKIE,
		serializeLinkedTokens(unique),
		sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60, url)
	);
}

/**
 * Look up several tokens in one query. Expired, revoked, or mobile sessions
 * drop out; the rest come back in the order the tokens were given, one per
 * user (the first token wins when a user somehow appears twice).
 */
export async function resolveLinkedSessions(
	db: D1Database,
	tokens: string[]
): Promise<ResolvedSession[]> {
	const unique = tokens.filter((token, index) => token && tokens.indexOf(token) === index);
	if (unique.length === 0) return [];

	const hashes = await Promise.all(unique.map((token) => hashToken(token)));
	const placeholders = hashes.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT s.token_hash, s.id AS session_id,
			        u.id, u.email, u.name, u.is_admin, u.must_change_password, u.created_at,
			        (SELECT a.address FROM addresses a
			          WHERE a.user_id = u.id
			          ORDER BY a.is_default DESC, a.address ASC
			          LIMIT 1) AS address
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash IN (${placeholders})
			   AND s.device_platform IS NULL
			   AND datetime(s.expires_at) > datetime('now')`
		)
		.bind(...hashes)
		.all<SessionRow>();

	const byHash = new Map(results.map((row) => [row.token_hash, row]));
	const seenUsers = new Set<string>();
	const resolved: ResolvedSession[] = [];
	unique.forEach((token, index) => {
		const row = byHash.get(hashes[index]);
		if (!row || seenUsers.has(row.id)) return;
		seenUsers.add(row.id);
		resolved.push({
			token,
			sessionId: row.session_id,
			address: row.address,
			user: {
				id: row.id,
				email: row.email,
				name: row.name,
				is_admin: row.is_admin === 1,
				must_change_password: row.must_change_password === 1,
				created_at: row.created_at
			}
		});
	});
	return resolved;
}

/** Shape the switcher renders: the active account first, then the parked ones. */
export function toLinkedAccounts(
	current: { user: User; address: string | null } | null,
	others: ResolvedSession[]
): LinkedAccount[] {
	const accounts: LinkedAccount[] = [];
	if (current) {
		accounts.push({
			id: current.user.id,
			email: current.user.email,
			name: current.user.name,
			address: current.address,
			current: true
		});
	}
	for (const session of others) {
		if (current && session.user.id === current.user.id) continue;
		accounts.push({
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
			address: session.address,
			current: false
		});
	}
	return accounts;
}
