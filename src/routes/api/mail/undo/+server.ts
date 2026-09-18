import { json, type RequestHandler } from '@sveltejs/kit';
import { undoCleanup } from '$lib/server/mail-cleanup';
import { statusForProviderError, describeProviderError } from '$lib/server/context';
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await request.json() as { id?: unknown };
    if (typeof id !== 'string') return json({ error: 'Action required' }, { status: 400 });
    return json({ ok: true, affected: await undoCleanup(platform.env.DB, locals.user.id, id) });
  } catch (error) { return json({ error: describeProviderError(error) }, { status: statusForProviderError(error) }); }
};
