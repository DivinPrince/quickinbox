import type { D1Database } from '@cloudflare/workers-types';
import { parseEmailAddress } from './email-address';

export async function listTrustedImageSenders(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db.prepare('SELECT sender FROM trusted_image_senders WHERE user_id = ? ORDER BY sender')
    .bind(userId).all<{ sender: string }>();
  return rows.results.map((row) => row.sender);
}

export async function trustImagesForMessage(db: D1Database, userId: string, messageId: string): Promise<boolean> {
  const message = await db.prepare("SELECT from_addr FROM emails WHERE id = ? AND user_id = ? AND direction = 'inbound'")
    .bind(messageId, userId).first<{ from_addr: string }>();
  if (!message) return false;
  const sender = parseEmailAddress(message.from_addr);
  if (!sender.includes('@')) return false;
  await db.prepare('INSERT INTO trusted_image_senders (user_id, sender) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .bind(userId, sender).run();
  return true;
}
