import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { hashToken, verifyPassword } from './crypto';
import { base32, decryptSecret, encryptSecret, matchingStep } from './totp';

export class MfaError extends Error {
 constructor(message: string, public status = 400) { super(message); }
}
export class MfaRequired extends Error {}
export type MfaState = {
 user_id: string; secret_encrypted: string; generation: string; last_used_step: number;
};
export type MfaActor = { userId: string; sessionId: string; passwordHash: string };
const CREDENTIAL_TABLES = ['sessions', 'api_tokens', 'pairing_codes', 'oauth_codes', 'oauth_grants', 'mfa_enrollments'];

export function getMfa(db: D1Database, userId: string): Promise<MfaState | null> {
 return db.prepare('SELECT user_id, secret_encrypted, generation, last_used_step FROM user_mfa WHERE user_id = ?').bind(userId).first<MfaState>();
}

export async function mfaStatus(db: D1Database, userId: string) {
 const row = await db.prepare(`SELECT enabled_at,
  (SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = user_mfa.user_id AND generation = user_mfa.generation) AS recovery_codes
  FROM user_mfa WHERE user_id = ?`).bind(userId).first<{ enabled_at: string; recovery_codes: number }>();
 return { enabled: Boolean(row), recoveryCodesRemaining: row?.recovery_codes ?? 0 };
}

export async function confirmMfaActor(db: D1Database, userId: string, sessionId: string, password: string): Promise<MfaActor> {
 const row = await db.prepare(`SELECT password_hash FROM users WHERE id = ? AND must_change_password = 0
  AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = users.id AND datetime(expires_at) > datetime('now'))`)
  .bind(userId, sessionId).first<{ password_hash: string }>();
 if (!row || !(await verifyPassword(password, row.password_hash))) throw new MfaError('Incorrect password or expired session.', 401);
 return { userId, sessionId, passwordHash: row.password_hash };
}

function actorGuard() {
 return `EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ? AND must_change_password = 0)
  AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND datetime(expires_at) > datetime('now'))`;
}
function actorArgs(actor: MfaActor) { return [actor.userId, actor.passwordHash, actor.sessionId, actor.userId]; }

export async function startMfaEnrollment(db: D1Database, actor: MfaActor, email: string, key: string | undefined) {
 const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
 const encrypted = await encryptSecret(secret, actor.userId, key);
 const id = crypto.randomUUID();
 const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
 const result = await db.prepare(`INSERT INTO mfa_enrollments (user_id, id, session_id, password_hash, secret_encrypted, expires_at)
  SELECT ?, ?, ?, ?, ?, ? WHERE ${actorGuard()} AND NOT EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ?)
  ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, session_id = excluded.session_id,
   password_hash = excluded.password_hash, secret_encrypted = excluded.secret_encrypted, expires_at = excluded.expires_at`)
  .bind(actor.userId, id, actor.sessionId, actor.passwordHash, encrypted, expiresAt, ...actorArgs(actor), actor.userId).run();
 if (!result.meta.changes) throw new MfaError('Setup is no longer available. Refresh Settings and try again.', 409);
 const uri = `otpauth://totp/${encodeURIComponent(`QuickInbox:${email}`)}?secret=${secret}&issuer=QuickInbox&algorithm=SHA1&digits=6&period=30`;
 return { enrollmentId: id, secret, uri, expiresAt };
}

async function newRecoveryCodes(userId: string) {
 const codes = Array.from({ length: 10 }, () => base32(crypto.getRandomValues(new Uint8Array(10))).match(/.{4}/g)!.join('-'));
 const hashes = await Promise.all(codes.map(code => recoveryHash(userId, code)));
 return { codes, hashes };
}
function recoveryHash(userId: string, code: string) {
 return hashToken(`quickinbox:recovery:v1:${userId}:${code.replace(/[\s-]/g, '').toUpperCase()}`);
}
function recoveryInserts(db: D1Database, userId: string, generation: string, hashes: string[]) {
 return hashes.map(hash => db.prepare(`INSERT INTO mfa_recovery_codes (user_id, generation, code_hash)
  SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ? AND generation = ?)`)
  .bind(userId, generation, hash, userId, generation));
}
function revokeCredentials(db: D1Database, userId: string, predicate: string, args: string[]) {
 return CREDENTIAL_TABLES.map(table => db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${predicate}`).bind(userId, ...args));
}

export async function enableMfa(db: D1Database, actor: MfaActor, enrollmentId: string, code: string, key: string | undefined) {
 const enrollment = await db.prepare(`SELECT secret_encrypted FROM mfa_enrollments
  WHERE user_id = ? AND id = ? AND session_id = ? AND password_hash = ? AND datetime(expires_at) > datetime('now')`)
  .bind(actor.userId, enrollmentId, actor.sessionId, actor.passwordHash).first<{ secret_encrypted: string }>();
 if (!enrollment) throw new MfaError('Setup expired. Start again with a new QR code.', 409);
 const secret = await decryptSecret(enrollment.secret_encrypted, actor.userId, key);
 const step = await matchingStep(secret, code, -1);
 if (step === null) throw new MfaError('Incorrect authenticator code. Try the current six-digit code.', 401);
 const generation = crypto.randomUUID();
 const { codes, hashes } = await newRecoveryCodes(actor.userId);
 const predicate = 'EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ? AND generation = ?)';
 const [enabled] = await db.batch([
  db.prepare(`INSERT INTO user_mfa (user_id, secret_encrypted, generation, last_used_step)
   SELECT user_id, secret_encrypted, ?, ? FROM mfa_enrollments WHERE user_id = ? AND id = ?
    AND session_id = ? AND password_hash = ? AND datetime(expires_at) > datetime('now')
    AND ${actorGuard()} AND NOT EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ?)`)
   .bind(generation, step, actor.userId, enrollmentId, actor.sessionId, actor.passwordHash, ...actorArgs(actor), actor.userId),
  ...recoveryInserts(db, actor.userId, generation, hashes),
  ...revokeCredentials(db, actor.userId, predicate, [actor.userId, generation])
 ]);
 if (!enabled.meta.changes) throw new MfaError('Your account changed during setup. Sign in and try again.', 409);
 return codes;
}

/** The marker lets later statements act only if this transaction consumed a proof. */
export async function mfaProof(db: D1Database, state: MfaState, code: string, key: string | undefined,
 passwordHash: string, sessionId?: string): Promise<{ statements: D1PreparedStatement[]; marker: string }> {
 const normalized = code.replace(/[\s-]/g, '').toUpperCase();
 const marker = crypto.randomUUID();
 let condition: string;
 let args: (string | number)[];
 let step = state.last_used_step;
 let recovery: string | null = null;
 if (/^\d{6}$/.test(normalized)) {
  const secret = await decryptSecret(state.secret_encrypted, state.user_id, key);
  const matched = await matchingStep(secret, normalized, state.last_used_step);
  if (matched === null) throw new MfaError('Invalid or already used code. Wait for a new code and try again.', 401);
  step = matched;
  condition = 'last_used_step < ?'; args = [step];
 } else if (/^[A-Z2-7]{16}$/.test(normalized)) {
  recovery = await recoveryHash(state.user_id, normalized);
  condition = `EXISTS (SELECT 1 FROM mfa_recovery_codes WHERE user_id = user_mfa.user_id
   AND generation = user_mfa.generation AND code_hash = ?)`;
  args = [recovery];
 } else {
  throw new MfaError('Enter a six-digit authenticator code or an unused recovery code.', 401);
 }
 // Password resets and session revocations must win over an in-flight proof.
 const sessionGuard = sessionId ? `AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = user_mfa.user_id AND datetime(expires_at) > datetime('now'))` : '';
 const statements = [db.prepare(`UPDATE user_mfa SET last_used_step = MAX(last_used_step, ?), last_verification = ?
  WHERE user_id = ? AND generation = ? AND ${condition}
   AND EXISTS (SELECT 1 FROM users WHERE id = user_mfa.user_id AND password_hash = ?) ${sessionGuard}`)
  .bind(step, marker, state.user_id, state.generation, ...args, passwordHash, ...(sessionId ? [sessionId] : []))];
 if (recovery) statements.push(db.prepare(`DELETE FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ?
  AND EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ? AND last_verification = ?)`)
  .bind(state.user_id, recovery, state.user_id, marker));
 return { statements, marker };
}

export async function changeMfa(db: D1Database, actor: MfaActor, code: string, key: string | undefined, action: 'disable' | 'regenerate') {
 const state = await getMfa(db, actor.userId);
 if (!state) throw new MfaError('Two-factor authentication is not enabled.', 409);
 const proof = await mfaProof(db, state, code, key, actor.passwordHash, actor.sessionId);
 const predicate = 'EXISTS (SELECT 1 FROM user_mfa WHERE user_id = ? AND last_verification = ?)';
 const args = [actor.userId, proof.marker];
 const { codes, hashes } = action === 'regenerate' ? await newRecoveryCodes(actor.userId) : { codes: [], hashes: [] };
 const batch = [
  ...proof.statements,
  db.prepare(`DELETE FROM mfa_recovery_codes WHERE user_id = ? AND ${predicate}`).bind(actor.userId, ...args),
  ...hashes.map(hash => db.prepare(`INSERT INTO mfa_recovery_codes (user_id, generation, code_hash)
   SELECT user_id, generation, ? FROM user_mfa WHERE user_id = ? AND last_verification = ?`).bind(hash, ...args)),
  ...revokeCredentials(db, actor.userId, predicate, args)
 ];
 if (action === 'disable') batch.push(db.prepare('DELETE FROM user_mfa WHERE user_id = ? AND last_verification = ?').bind(...args));
 const [verified] = await db.batch(batch);
 if (!verified.meta.changes) throw new MfaError('Invalid or already used code, or your session has expired.', 401);
 return codes;
}
