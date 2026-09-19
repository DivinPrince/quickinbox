import type { D1Database } from '@cloudflare/workers-types';
import { ProviderError } from './email-provider';
import { parseEmailAddress } from './email-address';
export type SenderRule = { id: string; sender: string; subject_contains: string; label_id: string | null; archive: number; enabled: number };
export async function listSenderRules(db: D1Database, userId: string) {
  return (await db.prepare('SELECT id, sender, subject_contains, label_id, archive, enabled FROM sender_rules WHERE user_id = ? ORDER BY created_at DESC, id').bind(userId).all<SenderRule>()).results;
}
export async function saveSenderRule(db: D1Database, userId: string, body: Record<string, unknown>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProviderError(400, 'invalid_rule', 'Invalid sender rule');
  const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
  if (body.id && !await db.prepare('SELECT id FROM sender_rules WHERE id = ? AND user_id = ?').bind(id, userId).first()) throw new ProviderError(404, 'not_found', 'Rule not found');
  if (typeof body.sender !== 'string' || body.sender.length > 320) throw new ProviderError(400, 'invalid_sender', 'Enter a sender email address');
  const sender = parseEmailAddress(body.sender);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)) throw new ProviderError(400, 'invalid_sender', 'Enter a complete sender email address');
  const subject = typeof body.subject_contains === 'string' ? body.subject_contains.trim() : '';
  if (subject.length > 200) throw new ProviderError(400, 'invalid_rule', 'Subject filter is too long');
  const label = typeof body.label_id === 'string' && body.label_id ? body.label_id : null;
  if (label && !await db.prepare('SELECT id FROM labels WHERE id = ? AND user_id = ?').bind(label, userId).first()) throw new ProviderError(400, 'invalid_label', 'Unknown label');
  const archive = body.archive === true || body.archive === 1;
  if (!archive && !label) throw new ProviderError(400, 'invalid_rule', 'Choose a label or automatic archiving');
  if (!body.id && (await listSenderRules(db, userId)).length >= 50) throw new ProviderError(400, 'rule_limit', 'Maximum 50 sender rules');
  await db.prepare(`INSERT INTO sender_rules (id, user_id, sender, subject_contains, label_id, archive, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sender = excluded.sender, subject_contains = excluded.subject_contains, label_id = excluded.label_id, archive = excluded.archive, enabled = excluded.enabled WHERE sender_rules.user_id = excluded.user_id`)
    .bind(id, userId, sender, subject, label, archive ? 1 : 0, body.enabled === false || body.enabled === 0 ? 0 : 1).run();
  return id;
}
