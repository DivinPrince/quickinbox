import { json, type RequestHandler } from '@sveltejs/kit';
import { archiveStream } from '$lib/server/mail-export';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
  if (!platform?.env.DB || !platform.env.ATTACHMENTS) return json({ error: 'Storage unavailable' }, { status: 503 });
  return new Response(archiveStream(platform.env.DB, platform.env.ATTACHMENTS), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="quickinbox-mail-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
