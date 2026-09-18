/// <reference types="bun" />
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { base32, decryptSecret, encryptSecret, matchingStep, totpCode } from './totp';
import { changeMfa, confirmMfaActor, enableMfa, getMfa, mfaStatus, MfaRequired, startMfaEnrollment } from './mfa';
import { getAuthenticatedSession, login, setUserPassword } from './auth';
import { hashPassword, hashToken } from './crypto';
import { resolveLinkedSessions } from './accounts';
import { createApiToken, getUserByApiToken } from './api-tokens';
import { getUserByOAuthToken } from './oauth';
import { POST as signIn } from '../../routes/api/auth/login/+server';
import { POST as settings } from '../../routes/api/auth/mfa/+server';
import type { RequestEvent } from '@sveltejs/kit';

// Fixture keys and accounts only. Never use production credentials in tests.
const KEY = Buffer.alloc(32, 17).toString('base64');
const PASSWORD = 'test-password-123';
const EMAIL = 'mfa@example.com';
const databases: Database[] = [];
afterEach(() => { for (const sql of databases.splice(0)) sql.close(); });

async function fixture() {
 const sql = new Database(':memory:'); databases.push(sql);
 for (const name of readdirSync('migrations').sort()) sql.exec(readFileSync(`migrations/${name}`, 'utf8'));
 const prepare = (query: string, args: (string | number | null)[] = []) => ({
  bind(...bound: (string | number | null)[]) { if (bound.length > 100) throw new Error('D1 parameter limit'); return prepare(query, bound); },
  execute() { const results = sql.query(query).all(...args); return { results, success: true, meta: { changes: (sql.query('SELECT changes() AS n').get() as { n: number }).n } }; },
  async all() { return this.execute(); }, async run() { return this.execute(); },
  async first(column?: string) { const row = sql.query(query).get(...args) as Record<string, unknown> | null; return column ? row?.[column] : row; }
 });
 const db = { prepare, async batch(statements: { execute: () => unknown }[]) { return sql.transaction(() => statements.map(s => s.execute()))(); } } as unknown as D1Database;
 sql.query('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)').run('u', EMAIL, 'Test', await hashPassword(PASSWORD));
 const session = await login(db, EMAIL, PASSWORD);
 expect(session).not.toBeNull();
 const resolved = await getAuthenticatedSession(db, session!.token);
 const actor = await confirmMfaActor(db, 'u', resolved!.sessionId, PASSWORD);
 return { sql, db, actor, token: session!.token };
}
async function enabled() {
 const f = await fixture();
 const enrollment = await startMfaEnrollment(f.db, f.actor, EMAIL, KEY);
 // Confirm with the previous step so a fresh current code is available immediately.
 const code = await totpCode(enrollment.secret, Math.floor(Date.now() / 30_000) - 1);
 const recovery = await enableMfa(f.db, f.actor, enrollment.enrollmentId, code, KEY);
 return { ...f, enrollment, recovery };
}
async function freshActor(f: Awaited<ReturnType<typeof enabled>>) {
 const result = await login(f.db, EMAIL, PASSWORD, { code: f.recovery[0], encryptionKey: KEY });
 const session = await getAuthenticatedSession(f.db, result!.token);
 return confirmMfaActor(f.db, 'u', session!.sessionId, PASSWORD);
}

for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
 test(`RFC 6238 SHA-1 vector at ${seconds}`, async () => {
  const secret = base32(new TextEncoder().encode('12345678901234567890'));
  expect(await totpCode(secret, Math.floor(seconds / 30), 8)).toBe(expected);
 });
}
test('authenticator ciphertext is randomized, account-bound and authenticated', async () => {
 const one = await encryptSecret('test-secret', 'u', KEY), two = await encryptSecret('test-secret', 'u', KEY);
 expect(one).not.toBe(two); expect(one).not.toContain('test-secret');
 expect(await decryptSecret(one, 'u', KEY)).toBe('test-secret');
 await expect(decryptSecret(one, 'other', KEY)).rejects.toThrow();
 await expect(decryptSecret(one, 'u', Buffer.alloc(32, 18).toString('base64'))).rejects.toThrow();
 const parts = one.split('.'); const bytes = Buffer.from(parts[2], 'base64'); bytes[0] ^= 1; parts[2] = bytes.toString('base64');
 await expect(decryptSecret(parts.join('.'), 'u', KEY)).rejects.toThrow();
 await expect(encryptSecret('test', 'u', undefined)).rejects.toThrow();
});
test('only adjacent time steps are accepted and consumed codes cannot replay', async () => {
 const secret = base32(new Uint8Array(20).fill(7)), now = 1234567890000, step = Math.floor(now / 30000);
 for (const offset of [-1, 0, 1]) expect(await matchingStep(secret, await totpCode(secret, step + offset), -1, now)).toBe(step + offset);
 expect(await matchingStep(secret, await totpCode(secret, step - 2), -1, now)).toBeNull();
 expect(await matchingStep(secret, await totpCode(secret, step), step, now)).toBeNull();
});
test('setup requires the password and confirmed code, keeps the secret encrypted, and revokes existing credentials', async () => {
 const f = await fixture();
 await expect(confirmMfaActor(f.db, 'u', f.actor.sessionId, 'wrong')).rejects.toThrow();
 const setup = await startMfaEnrollment(f.db, f.actor, EMAIL, KEY);
 expect(await getMfa(f.db, 'u')).toBeNull();
 expect(JSON.stringify(f.sql.query('SELECT * FROM mfa_enrollments').all())).not.toContain(setup.secret);
 await expect(enableMfa(f.db, f.actor, setup.enrollmentId, 'invalid', KEY)).rejects.toThrow();
 const api = await createApiToken(f.db, 'u', { scopes: ['mail:read'] });
 const codes = await enableMfa(f.db, f.actor, setup.enrollmentId, await totpCode(setup.secret, Math.floor(Date.now() / 30000)), KEY);
 expect(codes).toHaveLength(10); expect(new Set(codes).size).toBe(10);
 expect(await getAuthenticatedSession(f.db, f.token)).toBeNull();
 expect(await resolveLinkedSessions(f.db, [f.token])).toEqual([]);
 expect(await getUserByApiToken(f.db, api.token)).toBeNull();
 expect(JSON.stringify(f.sql.query('SELECT * FROM mfa_recovery_codes').all())).not.toContain(codes[0].replaceAll('-', ''));
 expect((await mfaStatus(f.db, 'u')).recoveryCodesRemaining).toBe(10);
});
test('expired or replaced enrollments and revoked sessions cannot enable 2FA', async () => {
 const f = await fixture();
 const setup = await startMfaEnrollment(f.db, f.actor, EMAIL, KEY);
 const code = await totpCode(setup.secret, Math.floor(Date.now()/30000));
 f.sql.exec("UPDATE mfa_enrollments SET expires_at = '2000-01-01'");
 await expect(enableMfa(f.db, f.actor, setup.enrollmentId, code, KEY)).rejects.toThrow();
 const next = await startMfaEnrollment(f.db, f.actor, EMAIL, KEY);
 await expect(enableMfa(f.db, f.actor, setup.enrollmentId, code, KEY)).rejects.toThrow();
 f.sql.exec('DELETE FROM sessions');
 await expect(enableMfa(f.db, f.actor, next.enrollmentId, await totpCode(next.secret, Math.floor(Date.now()/30000)), KEY)).rejects.toThrow();
 expect(await getMfa(f.db, 'u')).toBeNull();
});
test('password alone never issues a session for an enrolled account', async () => {
 const f = await enabled();
 await expect(login(f.db, EMAIL, PASSWORD)).rejects.toBeInstanceOf(MfaRequired);
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 expect(await login(f.db, EMAIL, 'wrong', { code: f.recovery[0] })).toBeNull();
 const code = await totpCode(f.enrollment.secret, Math.floor(Date.now()/30000));
 const session = await login(f.db, EMAIL, PASSWORD, { code, encryptionKey: KEY });
 expect((await getAuthenticatedSession(f.db, session!.token))?.user.id).toBe('u');
 expect((await resolveLinkedSessions(f.db, [session!.token]))[0]?.user.id).toBe('u');
 await expect(login(f.db, EMAIL, PASSWORD, { code, encryptionKey: KEY })).rejects.toThrow();
});
test('concurrent authenticator and recovery-code submissions have one winner', async () => {
 for (const useRecovery of [false, true]) {
  const f = await enabled();
  const code = useRecovery ? f.recovery[0] : await totpCode(f.enrollment.secret, Math.floor(Date.now()/30000));
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => login(f.db, EMAIL, PASSWORD, { code, encryptionKey: KEY })));
  expect(results.filter(r => r.status === 'fulfilled' && r.value !== null)).toHaveLength(1);
  expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(1);
 }
});
test('password reset preserves 2FA and recovery codes but invalidates existing sessions', async () => {
 const f = await enabled();
 await freshActor(f);
 await setUserPassword(f.db, 'u', 'replacement-password');
 expect((await mfaStatus(f.db, 'u')).enabled).toBe(true);
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 await expect(login(f.db, EMAIL, 'replacement-password')).rejects.toBeInstanceOf(MfaRequired);
 expect(await login(f.db, EMAIL, 'replacement-password', { code: f.recovery[1] })).not.toBeNull();
});
test('missing encryption key fails closed; recovery still works without decrypting a secret', async () => {
 const f = await enabled();
 await expect(login(f.db, EMAIL, PASSWORD, { code: await totpCode(f.enrollment.secret, Math.floor(Date.now()/30000)) })).rejects.toThrow();
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 expect(await login(f.db, EMAIL, PASSWORD, { code: f.recovery[0].toLowerCase() })).not.toBeNull();
 await expect(login(f.db, EMAIL, PASSWORD, { code: f.recovery[0] })).rejects.toThrow();
});
test('regeneration invalidates old recovery codes and signs out existing sessions', async () => {
 const f = await enabled(), actor = await freshActor(f);
 const codes = await changeMfa(f.db, actor, f.recovery[1], KEY, 'regenerate');
 expect(codes).toHaveLength(10);
 await expect(login(f.db, EMAIL, PASSWORD, { code: f.recovery[2] })).rejects.toThrow();
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 expect(await login(f.db, EMAIL, PASSWORD, { code: codes[0] })).not.toBeNull();
});
test('disabling requires a second factor and signs out every session', async () => {
 const f = await enabled(), actor = await freshActor(f);
 await expect(changeMfa(f.db, actor, 'invalid', KEY, 'disable')).rejects.toThrow();
 await changeMfa(f.db, actor, f.recovery[1], KEY, 'disable');
 expect(await getMfa(f.db, 'u')).toBeNull();
 expect(f.sql.query('SELECT * FROM mfa_recovery_codes').all()).toHaveLength(0);
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 expect(await login(f.db, EMAIL, PASSWORD)).not.toBeNull();
});
test('a password reset racing a valid second factor cannot create a session', async () => {
 const f = await enabled(), original = f.db.batch.bind(f.db);
 f.db.batch = (async (statements) => {
  f.sql.query('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('changed-password'), 'u');
  return original(statements);
 }) as D1Database['batch'];
 await expect(login(f.db, EMAIL, PASSWORD, { code: f.recovery[0] })).rejects.toThrow();
 expect(f.sql.query('SELECT * FROM sessions').all()).toHaveLength(0);
 expect((await mfaStatus(f.db, 'u')).recoveryCodesRemaining).toBe(10);
});
test('enabling 2FA wins over an in-flight password-only session issuance', async () => {
 const f = await fixture(), original = f.db.prepare.bind(f.db);
 f.db.prepare = ((query: string) => {
  if (query.includes('INSERT INTO sessions')) f.sql.exec("INSERT INTO user_mfa(user_id,secret_encrypted,generation) VALUES('u','encrypted','generation')");
  return original(query);
 }) as D1Database['prepare'];
 expect(await login(f.db, EMAIL, PASSWORD)).toBeNull();
});
test('legacy sessions, API keys and OAuth grants cannot bypass 2FA even if issued late', async () => {
 const f = await enabled();
 expect(() => f.sql.exec("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES('late','u','late','2099-01-01')")).toThrow();
 const api = await createApiToken(f.db, 'u', { scopes: ['mail:read'] });
 expect(await getUserByApiToken(f.db, api.token)).toBeNull();
 const token = 'qi_mcp_' + 'x'.repeat(48);
 f.sql.query(`INSERT INTO oauth_grants(id,family_id,client_id,user_id,scope,resource,access_hash,refresh_hash,access_expires_at,refresh_expires_at,created_at)
  VALUES('g','f','c','u','mail:read','https://example.com',?,'r','2099-01-01','2099-01-01','2026-01-01')`).run(await hashToken(token));
 expect(await getUserByOAuthToken(f.db, token)).toBeNull();
});

function event(f: Awaited<ReturnType<typeof fixture>>, body: unknown, path = '/api/auth/login', origin = 'https://inbox.example.com') {
 const set: string[] = [], deleted: string[] = [];
 const request = new Request('https://inbox.example.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(body) });
 return { set, deleted, event: { request, url: new URL(request.url), platform: { env: { DB: f.db, MFA_ENCRYPTION_KEY: KEY } },
  locals: { user: { id: 'u', email: EMAIL, must_change_password: false }, authMethod: 'session', currentSessionId: f.actor.sessionId },
  cookies: { get: () => undefined, set: (name: string) => set.push(name), delete: (name: string) => deleted.push(name) }
 } as unknown as RequestEvent };
}
test('HTTP login sets no session cookie before the second factor and throttles guesses', async () => {
 const f = await enabled();
 const first = event(f, { email: EMAIL, password: PASSWORD });
 const response = await signIn(first.event);
 expect(await response.json()).toEqual({ requiresTwoFactor: true }); expect(first.set).toEqual([]);
 const second = event(f, { email: EMAIL, password: PASSWORD, code: f.recovery[0], add: true });
 expect((await signIn(second.event)).status).toBe(200); expect(second.set).toContain('mail_session');
 for (let i=0; i<8; i++) expect((await signIn(event(f, { email: EMAIL, password: PASSWORD, code: 'bad' }).event)).status).toBe(401);
 expect((await signIn(event(f, { email: EMAIL, password: PASSWORD, code: f.recovery[1] }).event)).status).toBe(429);
});
test('2FA settings reject cross-origin, unauthenticated, malformed and oversized requests', async () => {
 const f = await fixture();
 expect((await settings(event(f, { action: 'start', password: PASSWORD }, '/api/auth/mfa', 'https://evil.example').event)).status).toBe(403);
 const anonymous = event(f, { action: 'start', password: PASSWORD }, '/api/auth/mfa'); anonymous.event.locals.authMethod = 'api_token';
 expect((await settings(anonymous.event)).status).toBe(401);
 expect((await settings(event(f, { action: 'start', password: PASSWORD, extra: 'x'.repeat(9000) }, '/api/auth/mfa').event)).status).toBe(400);
 expect((await signIn(event(f, null).event)).status).toBe(400);
});
