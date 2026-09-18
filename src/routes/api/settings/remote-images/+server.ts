import { json, type RequestHandler } from '@sveltejs/kit';
import { trustImagesForMessage } from '$lib/server/image-privacy';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json() as { messageId?: unknown };
  if (typeof body.messageId !== 'string') return json({ error: 'Message required' }, { status: 400 });
  const saved = await trustImagesForMessage(platform.env.DB, locals.user.id, body.messageId);
  return saved ? json({ ok: true }) : json({ error: 'Message not found' }, { status: 404 });
};

export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json() as { sender?: unknown };
  if (typeof body.sender !== 'string' || body.sender.length > 320) return json({ error: 'Sender required' }, { status: 400 });
  await platform.env.DB.prepare('DELETE FROM trusted_image_senders WHERE user_id = ? AND sender = ?')
    .bind(locals.user.id, body.sender).run();
  return json({ ok: true });
};
