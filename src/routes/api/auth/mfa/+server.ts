import { json, type RequestHandler } from '@sveltejs/kit';
import { checkRateLimit, SESSION_COOKIE } from '$lib/server/auth';
import { readAuthBody } from '$lib/server/auth-body';
import { changeMfa, confirmMfaActor, enableMfa, MfaError, startMfaEnrollment } from '$lib/server/mfa';

export const POST: RequestHandler = async ({ request, url, locals, platform, cookies }) => {
 const reply = (body: object, status = 200) => json(body, { status, headers: { 'Cache-Control': 'no-store' } });
 if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
  return reply({ error: 'Invalid request origin or content type.' }, 403);
 }
 if (!locals.user || locals.authMethod !== 'session' || !locals.currentSessionId || locals.user.must_change_password) {
  return reply({ error: 'Sign in and complete account setup first.' }, 401);
 }
 const db = platform?.env.DB;
 if (!db) return reply({ error: 'Database unavailable.' }, 503);
 if (!(await checkRateLimit(db, `mfa:settings:${locals.user.id}`, 10, 600))) {
  return json({ error: 'Too many attempts. Try again in 10 minutes.' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
 }
 const body = await readAuthBody(request);
 if (!body || typeof body.password !== 'string' || !body.password || body.password.length > 1024 ||
  !['start', 'enable', 'disable', 'regenerate'].includes(String(body.action)) ||
  (body.action !== 'start' && (typeof body.code !== 'string' || body.code.length > 64))) {
  return reply({ error: 'Enter your current password and verification code.' }, 400);
 }
 try {
  const actor = await confirmMfaActor(db, locals.user.id, locals.currentSessionId, body.password);
  const key = platform?.env.MFA_ENCRYPTION_KEY;
  if (body.action === 'start') {
   return reply(await startMfaEnrollment(db, actor, locals.user.email, key));
  }
  if (body.action === 'enable') {
   if (typeof body.enrollmentId !== 'string' || body.enrollmentId.length > 64) return reply({ error: 'Invalid setup.' }, 400);
   const recoveryCodes = await enableMfa(db, actor, body.enrollmentId, body.code as string, key);
   cookies.delete(SESSION_COOKIE, { path: '/' });
   return reply({ enabled: true, recoveryCodes });
  }
  const recoveryCodes = await changeMfa(db, actor, body.code as string, key, body.action as 'disable' | 'regenerate');
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return reply({ enabled: body.action !== 'disable', recoveryCodes });
 } catch (error) {
  if (error instanceof MfaError) return reply({ error: error.message }, error.status);
  return reply({ error: 'Two-factor settings are temporarily unavailable. Please try again or contact your administrator.' }, 503);
 }
};
