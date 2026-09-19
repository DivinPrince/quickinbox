import { json, type RequestHandler } from '@sveltejs/kit';
import { listSenderRules, saveSenderRule } from '$lib/server/sender-rules';
import { statusForProviderError, describeProviderError } from '$lib/server/context';
export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  return json({ rules: await listSenderRules(platform.env.DB, locals.user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
};
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  try { return json({ ok: true, id: await saveSenderRule(platform.env.DB, locals.user.id, await request.json()) }); }
  catch (error) { return json({ error: describeProviderError(error) }, { status: statusForProviderError(error) }); }
};
export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json() as { id?: unknown };
  if (typeof body.id !== 'string') return json({ error: 'Rule required' }, { status: 400 });
  await platform.env.DB.prepare('DELETE FROM sender_rules WHERE id = ? AND user_id = ?').bind(body.id, locals.user.id).run();
  return json({ ok: true });
};
