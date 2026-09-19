import { json, type RequestHandler } from '@sveltejs/kit';
import { persistDraft } from '$lib/server/drafts';
import { statusForProviderError, describeProviderError } from '$lib/server/context';
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB || !platform.env.ATTACHMENTS) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid draft' }, { status: 400 });
    return json({ ok: true, ...await persistDraft(platform.env, locals.user, body) });
  } catch (error) { return json({ error: describeProviderError(error) }, { status: statusForProviderError(error) }); }
};
