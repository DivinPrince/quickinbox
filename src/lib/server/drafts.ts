import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow, OutboundAttachmentInput, User } from '$lib/types';
import { ProviderError } from './email-provider';
import { assertOutboundAttachments, resolveFromAddress } from './outbox';
import { MAX_BODY_BYTES } from './constants';
import { normalizeSubject } from './threads';

export type DraftContent = { fromAddressId: string; to: string; cc: string; bcc: string; subject: string; text: string; html: string; attachments: OutboundAttachmentInput[] };
export type SavedDraft = EmailRow & { draft_revision: number; draft_save_id: string | null; draft_payload_key: string | null; attachments: OutboundAttachmentInput[] };
type Store = { DB: D1Database; ATTACHMENTS: R2Bucket };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);

export async function readSavedDraft(env: Store, userId: string, id: string): Promise<SavedDraft | null> {
  const row = await env.DB.prepare("SELECT * FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'").bind(id, userId).first<SavedDraft>();
  if (!row) return null;
  if (!row.draft_payload_key) return { ...row, attachments: [] };
  const object = await env.ATTACHMENTS.get(row.draft_payload_key);
  if (!object) throw new Error('Saved draft attachments could not be loaded. Try again before editing.');
  const content = await object.json<DraftContent>();
  return { ...row, attachments: content.attachments ?? [] };
}

/** The immutable R2 snapshot is complete before its pointer becomes visible in D1. */
export async function persistDraft(env: Store, user: User, raw: Record<string, unknown>) {
  const id = raw.id ?? crypto.randomUUID();
  const saveId = raw.saveId ?? crypto.randomUUID();
  const revision = raw.revision ?? 0;
  if (!validId(id) || !validId(saveId) || !Number.isSafeInteger(revision) || Number(revision) < 0) throw new ProviderError(400, 'invalid_draft', 'Invalid draft version');
  const old = await env.DB.prepare('SELECT user_id, status, draft_revision, draft_save_id, draft_payload_key FROM emails WHERE id = ?').bind(id)
    .first<{ user_id: string; status: string; draft_revision: number; draft_save_id: string | null; draft_payload_key: string | null }>();
  if (old && (old.user_id !== user.id || old.status !== 'draft')) throw new ProviderError(404, 'not_found', 'Draft not found');
  // A response may be lost after the save completed. Its retry is already saved.
  if (old?.draft_save_id === saveId) return { id, revision: old.draft_revision };
  if ((old?.draft_revision ?? 0) !== revision) throw new ProviderError(409, 'draft_conflict', 'This draft changed in another tab. Reopen the saved draft before replacing it. Your current text is still here.');
  const content = {} as DraftContent;
  for (const field of ['fromAddressId', 'to', 'cc', 'bcc', 'subject', 'text', 'html'] as const) {
    const value = raw[field] ?? '';
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > (field === 'text' || field === 'html' ? MAX_BODY_BYTES : 4000)) throw new ProviderError(400, 'invalid_draft', 'Draft field exceeds its size limit');
    content[field] = value;
  }
  if (raw.attachments !== undefined && !Array.isArray(raw.attachments)) throw new ProviderError(400, 'invalid_attachments', 'Invalid attachments');
  content.attachments = (raw.attachments ?? []) as OutboundAttachmentInput[];
  for (const file of content.attachments) if (!file || typeof file.filename !== 'string' || typeof file.content !== 'string' || typeof file.type !== 'string') throw new ProviderError(400, 'invalid_attachments', 'Invalid attachment');
  assertOutboundAttachments(content.attachments);
  const from = await resolveFromAddress(env.DB, user, content.fromAddressId);
  const key = `drafts/${user.id}/${id}/${saveId}.json`;
  const payload = JSON.stringify(content);
  await env.ATTACHMENTS.put(key, payload, { httpMetadata: { contentType: 'application/json' } });
  const values = [from.address, content.to, content.cc || null, content.bcc || null, content.subject, normalizeSubject(content.subject), content.text, content.html, from.domain_id, from.id, key, new TextEncoder().encode(payload).byteLength, content.attachments.length, saveId];
  // Both creation and update are conditional. A stale tab cannot replace a newer snapshot.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO emails (id, user_id, direction, status, is_read, thread_id, from_addr, to_addr, cc_addr, bcc_addr, subject, thread_key, body_text, body_html, domain_id, address_id, draft_payload_key, draft_payload_bytes, draft_attachment_count, draft_save_id, draft_revision)
      SELECT ?, ?, 'outbound', 'draft', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1 WHERE ? = 0 ON CONFLICT(id) DO NOTHING`).bind(id, user.id, id, ...values, revision),
    env.DB.prepare(`UPDATE emails SET from_addr = ?, to_addr = ?, cc_addr = ?, bcc_addr = ?, subject = ?, thread_key = ?, body_text = ?, body_html = ?, domain_id = ?, address_id = ?, draft_payload_key = ?, draft_payload_bytes = ?, draft_attachment_count = ?, draft_save_id = ?, draft_revision = draft_revision + 1, updated_at = datetime('now'), deleted_at = NULL
      WHERE id = ? AND user_id = ? AND status = 'draft' AND draft_revision = ? AND (draft_save_id IS NULL OR draft_save_id <> ?)`).bind(...values, id, user.id, revision, saveId),
    env.DB.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(user.id)
  ]);
  if (!result[0].meta.changes && !result[1].meta.changes) {
    // Another identical retry may have committed while this request was writing R2.
    const saved = await env.DB.prepare('SELECT draft_save_id FROM emails WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ draft_save_id: string }>();
    if (saved?.draft_save_id !== saveId) {
      await env.ATTACHMENTS.delete(key);
      throw new ProviderError(409, 'draft_conflict', 'This draft changed in another tab. Your current text has not been replaced.');
    }
  }
  if (old?.draft_payload_key && old.draft_payload_key !== key) {
    try { await env.ATTACHMENTS.delete(old.draft_payload_key); } catch { /* Saving succeeded; an old object can be cleaned up later. */ }
  }
  return { id, revision: Number(revision) + 1 };
}
