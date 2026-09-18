import type { D1Database } from '@cloudflare/workers-types';
import { ProviderError } from './email-provider';
import { chunkIds } from './d1';

const columns = { archive: 'archived_at', trash: 'deleted_at', snooze: 'snoozed_until', unsnooze: 'snoozed_until' } as const;
export type CleanupAction = keyof typeof columns;
export async function cleanupMail(db: D1Database, userId: string, action: CleanupAction, ids: string[], requestId: string, until?: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) || ids.length > 1000) throw new ProviderError(400, 'invalid_action', 'Invalid action request');
  let value: string | null = new Date().toISOString().replace('T', ' ').slice(0, 23);
  if (action === 'unsnooze') value = null;
  if (action === 'snooze') {
    const wake = Date.parse(until ?? '');
    if (!Number.isFinite(wake)) throw new ProviderError(400, 'invalid_snooze', 'Choose a valid wake-up time.');
    value = new Date(wake).toISOString().replace('T', ' ').slice(0, 19);
  }
  const fingerprint = JSON.stringify({ action, ids: [...new Set(ids)].sort(), until: action === 'snooze' ? value : null });
  const existing = await db.prepare('SELECT user_id, fingerprint, undone FROM mail_action_history WHERE id = ?').bind(requestId).first<{ user_id: string; fingerprint: string; undone: number }>();
  if (existing) {
    if (existing.user_id !== userId || existing.fingerprint !== fingerprint) throw new ProviderError(409, 'action_conflict', 'This action request has already been used.');
    return { affected: 0, undoId: existing.undone ? null : requestId };
  }
  if (action === 'snooze' && (Date.parse(until!) < Date.now() + 60_000 || Date.parse(until!) > Date.now() + 366 * 86400_000)) throw new ProviderError(400, 'invalid_snooze', 'Choose a time at least one minute ahead and within a year.');
  const column = columns[action];
  const statements = [db.prepare("INSERT INTO mail_action_history (id, user_id, action, fingerprint, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))").bind(requestId, userId, action, fingerprint)];
  for (const group of chunkIds([...new Set(ids)])) {
    const slots = group.map(() => '?').join(',');
    statements.push(db.prepare(`INSERT INTO mail_action_items (action_id, email_id, previous_value, previous_archived, revision)
      SELECT ?, id, ${column}, archived_at, cleanup_revision + 1 FROM emails WHERE user_id = ? AND id IN (${slots}) ${action === 'trash' ? '' : "AND (status IS NULL OR status <> 'draft')"}`).bind(requestId, userId, ...group));
  }
  statements.push(db.prepare(`UPDATE emails SET ${column} = ?, ${action === 'snooze' ? 'archived_at = NULL,' : ''} cleanup_revision = cleanup_revision + 1, updated_at = datetime('now') WHERE user_id = ? AND id IN (SELECT email_id FROM mail_action_items WHERE action_id = ?)`).bind(value, userId, requestId));
  statements.push(db.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(userId));
  const result = await db.batch(statements);
  return { affected: result[result.length - 2].meta.changes, undoId: requestId };
}

export async function undoCleanup(db: D1Database, userId: string, id: string) {
  const action = await db.prepare("SELECT action FROM mail_action_history WHERE id = ? AND user_id = ? AND undone = 0 AND expires_at > datetime('now')").bind(id, userId).first<{ action: CleanupAction }>();
  if (!action || !(action.action in columns)) throw new ProviderError(409, 'undo_expired', 'This action can no longer be undone.');
  const column = columns[action.action];
  const results = await db.batch([
    db.prepare(`UPDATE emails SET ${column} = (SELECT previous_value FROM mail_action_items WHERE action_id = ? AND email_id = emails.id), ${action.action === 'snooze' ? `archived_at = (SELECT previous_archived FROM mail_action_items WHERE action_id = ? AND email_id = emails.id),` : ''} cleanup_revision = cleanup_revision + 1, updated_at = datetime('now')
      WHERE user_id = ? AND EXISTS(SELECT 1 FROM mail_action_items i JOIN mail_action_history h ON h.id = i.action_id WHERE i.action_id = ? AND i.email_id = emails.id AND i.revision = emails.cleanup_revision AND h.undone = 0 AND h.expires_at > datetime('now'))`).bind(id, ...(action.action === 'snooze' ? [id] : []), userId, id),
    db.prepare('UPDATE mail_action_history SET undone = 1 WHERE id = ? AND user_id = ?').bind(id, userId),
    db.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(userId)
  ]);
  return results[0].meta.changes;
}

export async function wakeSnoozedMail(db: D1Database) {
  await db.batch([
    db.prepare("UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id IN (SELECT user_id FROM emails WHERE snoozed_until <= datetime('now'))"),
    db.prepare("UPDATE emails SET snoozed_until = NULL, cleanup_revision = cleanup_revision + 1, updated_at = datetime('now') WHERE snoozed_until <= datetime('now')"),
    db.prepare("DELETE FROM mail_action_history WHERE expires_at < datetime('now', '-1 day')")
  ]);
}
