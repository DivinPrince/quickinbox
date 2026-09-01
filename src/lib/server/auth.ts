import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
	PAIRING_CODE_TTL_MINUTES,
	MOBILE_SESSION_DAYS,
	SESSION_COOKIE,
	SESSION_DAYS
} from './constants';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from './crypto';
import type { User } from '$lib/types';

type UserRow = {
	id: string;
	email: string;
	name: string;
	is_admin: number;
	must_change_password: number;
	created_at: string;
};

function mapUser(row: UserRow): User {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		is_admin: row.is_admin === 1,
		must_change_password: row.must_change_password === 1,
		created_at: row.created_at
	};
}

export async function countUsers(db: D1Database): Promise<number> {
	const row = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
	return row?.count ?? 0;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<(User & { password_hash: string }) | null> {
	const row = await db
		.prepare(
			'SELECT id, email, name, password_hash, is_admin, must_change_password, created_at FROM users WHERE email = ?'
		)
		.bind(email.toLowerCase())
		.first<UserRow & { password_hash: string }>();

	return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
	const row = await db
		.prepare(
			'SELECT id, email, name, is_admin, must_change_password, created_at FROM users WHERE id = ?'
		)
		.bind(id)
		.first<UserRow>();

	return row ? mapUser(row) : null;
}

export async function listUsers(db: D1Database): Promise<User[]> {
	const { results } = await db
		.prepare(
			'SELECT id, email, name, is_admin, must_change_password, created_at FROM users ORDER BY created_at ASC'
		)
		.all<UserRow>();

	return results.map(mapUser);
}

export async function createUser(
	db: D1Database,
	input: {
		email: string;
		name: string;
		password: string;
		isAdmin?: boolean;
		mustChangePassword?: boolean;
	}
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
			`INSERT INTO users
			 (id, email, name, password_hash, is_admin, must_change_password)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			email,
			input.name.trim(),
			password_hash,
			input.isAdmin ? 1 : 0,
			input.mustChangePassword ? 1 : 0
		)
		.run();

	const user = await getUserById(db, id);
	if (!user) throw new Error('Failed to create user');
	return user;
}

/** Roll back an admin-created login when its mailbox could not be created. */
export async function deletePendingUser(db: D1Database, userId: string): Promise<void> {
	await db
		.prepare('DELETE FROM users WHERE id = ? AND must_change_password = 1')
		.bind(userId)
		.run();
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

export type DeviceSession = {
	id: string;
	device_name: string | null;
	device_platform: string | null;
	created_at: string;
	last_seen_at: string | null;
	expires_at: string;
	is_current: boolean;
};

export type AdminDeviceSession = Omit<DeviceSession, 'is_current'> & {
	user_id: string;
	user_name: string;
	user_email: string;
};

type DeviceSessionRow = Omit<DeviceSession, 'is_current'>;

function toIsoTimestamp(value: string): string {
	const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
	const parsed = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Create a long-lived bearer session for a paired mobile device. */
export async function createMobileSession(
	db: D1Database,
	input: { userId: string; deviceName: string; devicePlatform?: string }
): Promise<{ token: string; expiresAt: string }> {
	const token = createSessionToken();
	const token_hash = await hashToken(token);
	const sessionId = crypto.randomUUID();
	const expiresAt = new Date(
		Date.now() + MOBILE_SESSION_DAYS * 24 * 60 * 60 * 1000
	).toISOString();

	await db
		.prepare(
			`INSERT INTO sessions (id, user_id, token_hash, expires_at, device_name, device_platform, last_seen_at)
			 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
		)
		.bind(
			sessionId,
			input.userId,
			token_hash,
			expiresAt,
			input.deviceName,
			input.devicePlatform ?? 'ios'
		)
		.run();

	return { token, expiresAt };
}

export async function listDeviceSessions(
	db: D1Database,
	userId: string,
	currentSessionId: string | null = null
): Promise<DeviceSession[]> {
	const { results } = await db
		.prepare(
			`SELECT id, device_name, device_platform, created_at, last_seen_at, expires_at
			 FROM sessions
			 WHERE user_id = ? AND datetime(expires_at) > datetime('now')
			 ORDER BY created_at DESC`
		)
		.bind(userId)
		.all<DeviceSessionRow>();

	return results.map((session) => ({
		...session,
		created_at: toIsoTimestamp(session.created_at),
		last_seen_at: session.last_seen_at ? toIsoTimestamp(session.last_seen_at) : null,
		expires_at: toIsoTimestamp(session.expires_at),
		is_current: session.id === currentSessionId
	}));
}

/** Admin-only inventory of paired mobile sessions across every account. */
export async function listAllMobileDeviceSessions(
	db: D1Database
): Promise<AdminDeviceSession[]> {
	const { results } = await db
		.prepare(
			`SELECT s.id, s.user_id, u.name AS user_name, u.email AS user_email,
			        s.device_name, s.device_platform, s.created_at, s.last_seen_at, s.expires_at
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.device_platform IS NOT NULL
			   AND datetime(s.expires_at) > datetime('now')
			 ORDER BY s.last_seen_at DESC, s.created_at DESC`
		)
		.all<Omit<AdminDeviceSession, 'is_current'>>();

	return results.map((session) => ({
		...session,
		created_at: toIsoTimestamp(session.created_at),
		last_seen_at: session.last_seen_at ? toIsoTimestamp(session.last_seen_at) : null,
		expires_at: toIsoTimestamp(session.expires_at)
	}));
}

/** Revoke one device session. Returns false when it did not belong to the user. */
export async function revokeSession(db: D1Database, userId: string, sessionId: string): Promise<boolean> {
	const result = await db
		.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
		.bind(sessionId, userId)
		.run();
	return (result.meta.changes ?? 0) > 0;
}

// ---- Pairing codes -------------------------------------------------------

export async function createPairingCode(
	db: D1Database,
	userId: string
): Promise<{ code: string; expiresAt: string }> {
	// 128 bits of entropy, shown as a compact base64url string inside the QR.
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const code = toBase64Url(bytes);
	const code_hash = await hashToken(code);
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000).toISOString();

	// Clean up on generation as well as redemption so abandoned panels do not
	// grow the table indefinitely. Separate tabs may each keep their own valid
	// code; opening one tab must not silently invalidate the QR shown in another.
	await deleteExpiredPairingCodes(db);
	await db
		.prepare('INSERT INTO pairing_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)')
		.bind(id, userId, code_hash, expiresAt)
		.run();

	return { code, expiresAt };
}

/**
 * Exchange a one-time code for a mobile session. Single-use and expiry-checked
 * in one transactional D1 batch.
 */
export async function redeemPairingCode(
	db: D1Database,
	code: string,
	device: { name: string; platform?: string }
): Promise<{ token: string; expiresAt: string } | null> {
	const code_hash = await hashToken(code);
	const token = createSessionToken();
	const token_hash = await hashToken(token);
	const sessionId = crypto.randomUUID();
	const expiresAt = new Date(
		Date.now() + MOBILE_SESSION_DAYS * 24 * 60 * 60 * 1000
	).toISOString();
	const deviceName = device.name.slice(0, 64).trim() || 'Mobile device';
	const devicePlatform = device.platform === 'android' ? 'android' : 'ios';

	// D1 batches are transactional. Inserting directly from the still-valid code
	// makes the code-to-session exchange a single-winner operation, and a failed
	// session insert cannot burn the code. The second statement removes the code
	// only when this batch actually created its session.
	const [inserted] = await db.batch([
		db
			.prepare(
				`INSERT INTO sessions
					(id, user_id, token_hash, expires_at, device_name, device_platform, last_seen_at)
				 SELECT ?, user_id, ?, ?, ?, ?, datetime('now')
				 FROM pairing_codes
				 WHERE code_hash = ?
				   AND used_at IS NULL
				   AND datetime(expires_at) > datetime('now')`
			)
			.bind(sessionId, token_hash, expiresAt, deviceName, devicePlatform, code_hash),
		db
			.prepare(
				`DELETE FROM pairing_codes
				 WHERE code_hash = ?
				   AND EXISTS (SELECT 1 FROM sessions WHERE id = ?)`
			)
			.bind(code_hash, sessionId)
	]);

	if ((inserted.meta.changes ?? 0) === 0) return null;
	return { token, expiresAt };
}

export async function deleteExpiredPairingCodes(db: D1Database): Promise<void> {
	await db
		.prepare(
			`DELETE FROM pairing_codes
			 WHERE datetime(expires_at) <= datetime('now')
			    OR (used_at IS NOT NULL AND datetime(used_at) <= datetime('now', '-1 hour'))`
		)
		.run();
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// ---- Rate limiting -------------------------------------------------------

/**
 * Fixed-window counter. Returns true when allowed (and increments), false when
 * the caller has exhausted this window's budget.
 */
export async function checkRateLimit(
	db: D1Database,
	key: string,
	max: number,
	windowSeconds: number
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - (now % windowSeconds);

	const row = await db
		.prepare(
			`INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
			 ON CONFLICT(key) DO UPDATE SET
				count = CASE
					WHEN rate_limits.window_start = excluded.window_start
						THEN min(rate_limits.count + 1, ?)
					ELSE 1
				END,
				window_start = excluded.window_start
			 RETURNING count`
		)
		.bind(key, windowStart, max + 1)
		.first<{ count: number }>();

	// Keep one day of counters for short-window abuse visibility without
	// retaining a permanent row for every observed client address.
	await db
		.prepare('DELETE FROM rate_limits WHERE window_start < ?')
		.bind(windowStart - 24 * 60 * 60)
		.run();

	return Boolean(row && row.count <= max);
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

export async function completeFirstLogin(
	db: D1Database,
	userId: string,
	input: { name: string; password: string }
): Promise<void> {
	const name = input.name.trim();
	if (!name) {
		throw new Error('Name is required');
	}
	if (name.length > 128) {
		throw new Error('Name must be 128 characters or fewer');
	}
	if (input.password.length < 8 || input.password.length > 1024) {
		if (input.password.length > 1024) {
			throw new Error('Password must be 1024 characters or fewer');
		}
		throw new Error('Password must be at least 8 characters');
	}

	const current = await db
		.prepare(
			'SELECT password_hash FROM users WHERE id = ? AND must_change_password = 1'
		)
		.bind(userId)
		.first<{ password_hash: string }>();
	if (!current) {
		throw new Error('Account setup is already complete');
	}
	if (await verifyPassword(input.password, current.password_hash)) {
		throw new Error('Choose a password different from the temporary password');
	}

	const password_hash = await hashPassword(input.password);
	const [result] = await db.batch([
		db
			.prepare(
				`UPDATE users
				 SET name = ?, password_hash = ?, must_change_password = 0
				 WHERE id = ? AND must_change_password = 1`
			)
			.bind(name, password_hash, userId),
		db
			.prepare(
				`DELETE FROM sessions
				 WHERE user_id = ?
				   AND EXISTS (
					SELECT 1 FROM users
					WHERE id = ? AND password_hash = ? AND must_change_password = 0
				   )`
			)
			.bind(userId, userId, password_hash),
		db
			.prepare(
				`DELETE FROM api_tokens
				 WHERE user_id = ?
				   AND EXISTS (
					SELECT 1 FROM users
					WHERE id = ? AND password_hash = ? AND must_change_password = 0
				   )`
			)
			.bind(userId, userId, password_hash)
	]);

	if ((result.meta.changes ?? 0) === 0) {
		throw new Error('Account setup is already complete');
	}
}

/**
 * Grant or withdraw admin.
 *
 * Promotion needs no guard. Demotion does: the count travels with the UPDATE
 * rather than being read first, so two admins demoting each other concurrently
 * cannot both pass a stale check and leave the instance with nobody. Demoting
 * someone who is already not an admin is a no-op that still reports success.
 */
export async function setUserAdmin(
	db: D1Database,
	actor: User,
	targetId: string,
	isAdmin: boolean
): Promise<void> {
	if (actor.id === targetId) {
		throw new Error('You cannot change your own role');
	}

	const target = await getUserById(db, targetId);
	if (!target) {
		throw new Error('User not found');
	}

	if (isAdmin) {
		await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(targetId).run();
		return;
	}

	const result = await db
		.prepare(
			`UPDATE users SET is_admin = 0
			 WHERE id = ?
			   AND (is_admin = 0 OR (SELECT COUNT(*) FROM users WHERE is_admin = 1) > 1)`
		)
		.bind(targetId)
		.run();

	if ((result.meta?.changes ?? 0) === 0) {
		throw new Error('Keep at least one admin');
	}
}

/**
 * Removes the account and everything the D1 cascade takes with it — sessions,
 * addresses, mail — plus the R2 objects the mail's attachments point at, which
 * the cascade cannot reach.
 */
export async function deleteUser(
	db: D1Database,
	bucket: R2Bucket | undefined,
	actor: User,
	targetId: string
): Promise<void> {
	if (actor.id === targetId) {
		throw new Error('You cannot delete your own account');
	}

	const target = await getUserById(db, targetId);
	if (!target) {
		throw new Error('User not found');
	}

	// One transaction: D1 rolls a batch back entirely if any statement fails, so
	// the account can never be gone while its mail, sessions and tokens survive.
	//
	// The key read is the batch's first statement rather than a preceding query.
	// Reading outside the transaction leaves a window in which inbound delivery
	// commits an attachment whose metadata this then deletes without ever having
	// collected its object.
	//
	// The last-admin rule rides on the DELETE rather than a preceding read —
	// counting first and deleting after lets two admins delete each other
	// concurrently, both seeing two admins, leaving nobody. The child statements
	// are then gated on the user actually having gone, so a refused delete
	// leaves the account whole instead of stripping it inside the same batch.
	//
	// Older D1 databases were created without ON DELETE CASCADE enforcement, so
	// the children are cleared explicitly; where the cascade ran they are no-ops.
	// email_attachments is reachable only through emails, so it goes first.
	const gone = 'NOT EXISTS (SELECT 1 FROM users WHERE id = ?)';
	const [keys, deletion] = await db.batch<{ storage_key: string }>([
		db
			.prepare(
				`SELECT storage_key FROM email_attachments
				 WHERE storage_key IS NOT NULL
				   AND email_id IN (SELECT id FROM emails WHERE user_id = ?)`
			)
			.bind(targetId),
		db
			.prepare(
				`DELETE FROM users
				 WHERE id = ?
				   AND (is_admin = 0 OR (SELECT COUNT(*) FROM users WHERE is_admin = 1) > 1)`
			)
			.bind(targetId),
		db
			.prepare(
				`DELETE FROM email_attachments
				 WHERE email_id IN (SELECT id FROM emails WHERE user_id = ?) AND ${gone}`
			)
			.bind(targetId, targetId),
		db.prepare(`DELETE FROM emails WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
		db.prepare(`DELETE FROM addresses WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
		db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
		db.prepare(`DELETE FROM api_tokens WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
		db.prepare(`DELETE FROM pairing_codes WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
		db
			.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND ${gone}`)
			.bind(targetId, targetId),
		db
			.prepare(
				`UPDATE domains SET catchall_user_id = NULL WHERE catchall_user_id = ? AND ${gone}`
			)
			.bind(targetId, targetId)
	]);

	if ((deletion.meta?.changes ?? 0) === 0) {
		throw new Error('Keep at least one admin');
	}

	const storageKeys = (keys.results ?? []).map((row) => row.storage_key);

	// Purged only after the row is gone, so a refused delete never strands mail
	// without the files it references. Best-effort from here: the account is
	// already deleted, so a storage hiccup must not report failure — the caller
	// would retry and be told the user does not exist, with the strays no longer
	// reachable from any metadata. Log them instead.
	if (bucket && storageKeys.length > 0) {
		const purged = await Promise.allSettled(storageKeys.map((key) => bucket.delete(key)));
		purged.forEach((outcome, index) => {
			if (outcome.status === 'rejected') {
				console.error('Failed to delete attachment object', storageKeys[index], outcome.reason);
			}
		});
	}
}

export type AuthenticatedSession = {
	user: User;
	sessionId: string;
	isMobile: boolean;
};

/**
 * Resolve a raw credential to its user and opaque database session id. The raw
 * token and its hash remain server-only; callers can safely use `sessionId` to
 * identify the active row in a list that already exposes revocable row ids.
 */
export async function getAuthenticatedSession(
	db: D1Database,
	token: string | undefined
): Promise<AuthenticatedSession | null> {
	if (!token) return null;

	const token_hash = await hashToken(token);
	const row = await db
		.prepare(
			`SELECT s.id AS session_id, s.device_platform, s.last_seen_at,
			        u.id, u.email, u.name, u.is_admin, u.must_change_password, u.created_at
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')`
		)
		.bind(token_hash)
		.first<
			UserRow & { session_id: string; device_platform: string | null; last_seen_at: string | null }
		>();

	if (!row) return null;
	if (row.must_change_password === 1 && row.device_platform) return null;

	const lastSeenAt = row.last_seen_at
		? Date.parse(toIsoTimestamp(row.last_seen_at))
		: Number.NaN;
	if (
		row.device_platform &&
		(!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= 5 * 60 * 1000)
	) {
		await db
			.prepare(
				`UPDATE sessions SET last_seen_at = datetime('now')
				 WHERE id = ?
				   AND (last_seen_at IS NULL OR datetime(last_seen_at) <= datetime('now', '-5 minutes'))`
			)
			.bind(row.session_id)
			.run();
	}

	return {
		user: mapUser(row),
		sessionId: row.session_id,
		isMobile: Boolean(row.device_platform)
	};
}

export async function getUserFromSession(db: D1Database, token: string | undefined): Promise<User | null> {
	return (await getAuthenticatedSession(db, token))?.user ?? null;
}

/**
 * `secure` follows the scheme rather than being pinned on: Chrome makes an
 * exception for http://localhost and stores the cookie anyway, but WebKit does
 * not, so a hardcoded flag logs in successfully and then drops the session on
 * every `bun run dev` visit in Safari. Deployments are https, so they still get
 * the flag.
 */
export function sessionCookieOptions(maxAgeSeconds: number, url: URL) {
	return {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax' as const,
		maxAge: maxAgeSeconds
	};
}

export function readSessionToken(cookies: { get: (name: string) => string | undefined }): string | undefined {
	return cookies.get(SESSION_COOKIE);
}

export { SESSION_COOKIE };
