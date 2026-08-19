import type { D1Database } from '@cloudflare/workers-types';
import { SESSION_COOKIE, SESSION_DAYS } from './constants';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from './crypto';
import type { User } from '$lib/types';

type UserRow = {
	id: string;
	email: string;
	name: string;
	is_admin: number;
	created_at: string;
};

function mapUser(row: UserRow): User {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		is_admin: row.is_admin === 1,
		created_at: row.created_at
	};
}

export async function countUsers(db: D1Database): Promise<number> {
	const row = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
	return row?.count ?? 0;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<(User & { password_hash: string }) | null> {
	const row = await db
		.prepare('SELECT id, email, name, password_hash, is_admin, created_at FROM users WHERE email = ?')
		.bind(email.toLowerCase())
		.first<UserRow & { password_hash: string }>();

	return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
	const row = await db
		.prepare('SELECT id, email, name, is_admin, created_at FROM users WHERE id = ?')
		.bind(id)
		.first<UserRow>();

	return row ? mapUser(row) : null;
}

export async function listUsers(db: D1Database): Promise<User[]> {
	const { results } = await db
		.prepare('SELECT id, email, name, is_admin, created_at FROM users ORDER BY created_at ASC')
		.all<UserRow>();

	return results.map(mapUser);
}

export async function createUser(
	db: D1Database,
	input: { email: string; name: string; password: string; isAdmin?: boolean }
): Promise<User> {
	// This is a login identity only. Mail identities live in `addresses` and are
	// bound to connected Resend domains, so an operator can sign in with any
	// address they control while sending as name@their-resend-domain.
	const email = input.email.toLowerCase().trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error('Enter a valid email address');
	}

	const existing = await getUserByEmail(db, email);
	if (existing) {
		throw new Error('An account with that email already exists');
	}

	const id = crypto.randomUUID();
	const password_hash = await hashPassword(input.password);

	await db
		.prepare(
			'INSERT INTO users (id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(id, email, input.name.trim(), password_hash, input.isAdmin ? 1 : 0)
		.run();

	const user = await getUserById(db, id);
	if (!user) throw new Error('Failed to create user');
	return user;
}

export async function bootstrapAdmin(
	db: D1Database,
	input: { email: string; name: string; password: string }
): Promise<User> {
	const existing = await countUsers(db);
	if (existing > 0) {
		throw new Error('Setup already completed');
	}

	return createUser(db, { ...input, isAdmin: true });
}

export async function login(
	db: D1Database,
	email: string,
	password: string
): Promise<{ user: User; token: string } | null> {
	const user = await getUserByEmail(db, email);
	if (!user) return null;

	const valid = await verifyPassword(password, user.password_hash);
	if (!valid) return null;

	const token = createSessionToken();
	const token_hash = await hashToken(token);
	const sessionId = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

	await db
		.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
		.bind(sessionId, user.id, token_hash, expiresAt)
		.run();

	const { password_hash: _, ...safeUser } = user;
	return { user: safeUser, token };
}

export async function logout(db: D1Database, token: string): Promise<void> {
	const token_hash = await hashToken(token);
	await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(token_hash).run();
}

export async function setUserPassword(
	db: D1Database,
	userId: string,
	password: string
): Promise<void> {
	if (password.length < 8) {
		throw new Error('Password must be at least 8 characters');
	}

	const password_hash = await hashPassword(password);
	const result = await db
		.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
		.bind(password_hash, userId)
		.run();

	if ((result.meta.changes ?? 0) === 0) {
		throw new Error('User not found');
	}

	// Password rotation must cut off every login path, including long-lived keys.
	await db.batch([
		db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
		db.prepare('DELETE FROM api_tokens WHERE user_id = ?').bind(userId)
	]);
}

export async function deleteUser(db: D1Database, actor: User, targetId: string): Promise<void> {
	if (actor.id === targetId) {
		throw new Error('You cannot delete your own account');
	}

	const target = await getUserById(db, targetId);
	if (!target) {
		throw new Error('User not found');
	}

	if (target.is_admin) {
		const admins = (await listUsers(db)).filter((user) => user.is_admin);
		if (admins.length <= 1) {
			throw new Error('Keep at least one admin');
		}
	}

	await db.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
}

export async function getUserFromSession(db: D1Database, token: string | undefined): Promise<User | null> {
	if (!token) return null;

	const token_hash = await hashToken(token);
	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.is_admin, u.created_at
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
		)
		.bind(token_hash)
		.first<UserRow>();

	return row ? mapUser(row) : null;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge: maxAgeSeconds
	};
}

export function readSessionToken(cookies: { get: (name: string) => string | undefined }): string | undefined {
	return cookies.get(SESSION_COOKIE);
}

export { SESSION_COOKIE };
