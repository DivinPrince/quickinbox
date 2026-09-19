import { json, type RequestHandler } from '@sveltejs/kit';
import { retryOutboxJob } from '$lib/server/durable-outbox';
import { describeProviderError, getEmailProvider, statusForProviderError } from '$lib/server/context';

export const POST: RequestHandler = async ({ request, params, locals, platform }) => {
  if (!locals.user || !platform?.env.DB || !platform.env.ATTACHMENTS) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json() as { confirmDuplicateRisk?: unknown };
  try {
    await retryOutboxJob(platform.env, getEmailProvider(platform), locals.user.id, params.id!, body.confirmDuplicateRisk === true);
    return json({ ok: true });
  } catch (error) {
    return json({ error: describeProviderError(error) }, { status: statusForProviderError(error) });
  }
};
