import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailProviderKind } from '$lib/types';
import { insertAttachments } from './attachments';
import { ProviderError, type EmailProvider } from './email-provider';
import { insertEmail } from './mail-store';
import { recordOperationalFailure } from './operational-events';
import type { OutboundMailInput } from './send-mail';

export type OutboxState = 'preparing' | 'pending' | 'sending' | 'retry' | 'accepted' | 'failed' | 'uncertain';
export type OutboxJob = {
  id: string;
  user_id: string;
  request_key: string;
  fingerprint: string;
  provider: EmailProviderKind;
  state: OutboxState;
  email_id: string | null;
  payload_key: string;
  payload_bytes: number;
  prepared: number;
  attempts: number;
  first_attempt_at: number | null;
  next_attempt_at: number;
  lease_until: number;
  provider_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
type Store = { DB: D1Database; ATTACHMENTS: R2Bucket };
const LEASE_MS = 5 * 60_000;
// Resend retains keys for 24h. Stop comfortably before that boundary.
const RETRY_WINDOW_MS = 23 * 60 * 60_000;
const MAX_ATTEMPTS = 5;
const UNCERTAIN = 'The provider may have accepted this message. Check with the recipient before sending again.';

export async function getOutboxJob(db: D1Database, id: string): Promise<OutboxJob | null> {
  return db.prepare('SELECT * FROM outbox_jobs WHERE id = ?').bind(id).first<OutboxJob>();
}

async function fingerprint(input: OutboundMailInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A reservation prevents concurrent HTTP retries from creating two messages. */
export async function enqueueOutbound(
  env: Store,
  provider: EmailProviderKind,
  input: OutboundMailInput,
  email: Parameters<typeof insertEmail>[1],
  requestKey: string = crypto.randomUUID()
): Promise<OutboxJob> {
  if (!/^[\x21-\x7e]{1,200}$/.test(requestKey)) {
    throw new ProviderError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 1–200 printable ASCII characters.');
  }
  const hash = await fingerprint(input);
  const id = crypto.randomUUID();
  const now = Date.now();
  const reserved = await env.DB.prepare(`INSERT INTO outbox_jobs
    (id, user_id, request_key, fingerprint, provider, state, payload_key, lease_until)
    VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?)
    ON CONFLICT(user_id, request_key) DO NOTHING`)
    .bind(id, email.userId, requestKey, hash, provider, `outbox/${id}.json`, now + LEASE_MS).run();
  let job = await env.DB.prepare('SELECT * FROM outbox_jobs WHERE user_id = ? AND request_key = ?')
    .bind(email.userId, requestKey).first<OutboxJob>();
  if (!job) throw new Error('Could not reserve the outgoing message');
  if (job.fingerprint !== hash) {
    throw new ProviderError(409, 'idempotency_conflict', 'This send request already belongs to a different message. Start a new message to send different content.');
  }
  if (job.prepared) return job;
  if (!reserved.meta.changes) {
    const claimed = await env.DB.prepare(`UPDATE outbox_jobs SET state = 'preparing', lease_until = ?,
      last_error = NULL, updated_at = datetime('now') WHERE id = ? AND prepared = 0
      AND (state = 'failed' OR (state = 'preparing' AND lease_until < ?))`)
      .bind(now + LEASE_MS, job.id, now).run();
    if (!claimed.meta.changes) {
      throw new ProviderError(409, 'send_in_progress', 'This message is still being saved. Please try again in a moment.');
    }
  }
  try {
    const payload = JSON.stringify({ ...input, idempotencyKey: `quickinbox/${job.id}` });
    await env.ATTACHMENTS.put(job.payload_key, payload, { httpMetadata: { contentType: 'application/json' } });
    const exists = await env.DB.prepare('SELECT id FROM emails WHERE id = ?').bind(job.id).first();
    if (!exists) await insertEmail(env.DB, { ...email, id: job.id, status: 'pending' });
    await env.DB.prepare('UPDATE outbox_jobs SET email_id = ? WHERE id = ?').bind(job.id, job.id).run();
    await insertAttachments(env.DB, env.ATTACHMENTS, job.id, input.attachments ?? [], {
      enforceCountLimit: false, stableIds: true
    });
    await env.DB.batch([
      env.DB.prepare(`UPDATE outbox_jobs SET state = 'pending', prepared = 1, payload_bytes = ?,
        lease_until = 0, last_error = NULL, updated_at = datetime('now') WHERE id = ?`)
        .bind(new TextEncoder().encode(payload).byteLength, job.id),
      env.DB.prepare(`UPDATE emails SET status = 'pending', status_detail = NULL,
        status_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(job.id)
    ]);
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE outbox_jobs SET state = 'failed', lease_until = 0,
        last_error = 'Message was not sent because it could not be fully saved.', updated_at = datetime('now') WHERE id = ?`).bind(job.id),
      env.DB.prepare(`UPDATE emails SET status = 'failed', status_detail = 'Message was not fully saved. Retry from the composer.',
        updated_at = datetime('now') WHERE id = ?`).bind(job.id)
    ]);
    await recordOperationalFailure(env.DB, 'outbound', 'An outgoing message could not be saved. No delivery was attempted.');
    throw error;
  }
  job = await getOutboxJob(env.DB, job.id);
  if (!job) throw new Error('Outgoing message disappeared');
  return job;
}

export function failureState(provider: EmailProviderKind, error: unknown, attempts: number): OutboxState {
  const known = error instanceof ProviderError;
  if (provider === 'cloudflare') {
    if (known && error.code === 'E_RATE_LIMIT_EXCEEDED') return attempts < MAX_ATTEMPTS ? 'retry' : 'failed';
    // Only explicit provider rejection codes establish that nothing was sent.
    if (known && ['E_SENDER_NOT_VERIFIED', 'E_INVALID_EMAIL', 'E_INVALID_RECIPIENT', 'E_INVALID_SENDER',
      'E_INVALID_REQUEST', 'E_INVALID_ATTACHMENT', 'E_MESSAGE_TOO_LARGE', 'E_TOO_MANY_RECIPIENTS'].includes(error.code)) return 'failed';
    return 'uncertain';
  }
  if (known && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) return 'failed';
  if (attempts < MAX_ATTEMPTS) return 'retry';
  return known && error.status === 429 ? 'failed' : 'uncertain';
}

async function setState(db: D1Database, job: OutboxJob, state: OutboxState, detail: string | null): Promise<void> {
  const status = state === 'retry' ? 'pending' : state;
  await db.batch([
    db.prepare(`UPDATE outbox_jobs SET state = ?, last_error = ?, lease_until = 0, next_attempt_at = ?,
      updated_at = datetime('now') WHERE id = ? AND state != 'accepted'`)
      .bind(state, detail, Date.now() + Math.min(60_000 * 2 ** Math.max(job.attempts - 1, 0), 3_600_000), job.id),
    db.prepare(`UPDATE emails SET status = ?, status_detail = ?, status_at = datetime('now'),
      updated_at = datetime('now') WHERE id = ? AND status NOT IN ('accepted', 'sent', 'delivered', 'bounced', 'complained', 'delayed')`)
      .bind(status, detail, job.email_id),
    db.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(job.user_id)
  ]);
}

async function finalizeAccepted(env: Store, job: OutboxJob): Promise<void> {
  await env.DB.prepare(`UPDATE emails SET provider_id = ?, status = CASE
    WHEN status IN ('pending', 'sending', 'failed', 'uncertain') THEN COALESCE((SELECT status FROM outbound_delivery_events WHERE provider_id = ?), 'accepted') ELSE status END,
    status_detail = CASE WHEN status IN ('pending', 'sending', 'failed', 'uncertain') THEN (SELECT detail FROM outbound_delivery_events WHERE provider_id = ?) ELSE status_detail END,
    status_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(job.provider_id, job.provider_id, job.provider_id, job.email_id).run();
  await env.DB.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(job.user_id).run();
  if (job.payload_bytes) {
    await env.ATTACHMENTS.delete(job.payload_key);
    await env.DB.prepare('UPDATE outbox_jobs SET payload_bytes = 0 WHERE id = ?').bind(job.id).run();
  }
}

/** Called immediately after persistence and by the scheduled recovery worker. */
export async function deliverOutboxJob(env: Store, provider: EmailProvider, id: string): Promise<void> {
  let job = await getOutboxJob(env.DB, id);
  if (!job || !job.prepared) return;
  if (job.state === 'accepted') return finalizeAccepted(env, job);
  if (!['pending', 'retry'].includes(job.state) || job.next_attempt_at > Date.now()) return;
  if (job.provider !== provider.kind) {
    await setState(env.DB, job, 'failed', 'The configured mail provider changed. Restore the original provider before retrying.');
    return;
  }
  if (job.provider === 'resend' && job.first_attempt_at && Date.now() - job.first_attempt_at >= RETRY_WINDOW_MS) {
    await setState(env.DB, job, 'uncertain', UNCERTAIN);
    return;
  }
  const claimed = await env.DB.prepare(`UPDATE outbox_jobs SET state = 'sending', attempts = attempts + 1,
    lease_until = ?, updated_at = datetime('now') WHERE id = ? AND state IN ('pending', 'retry') AND next_attempt_at <= ?`)
    .bind(Date.now() + LEASE_MS, id, Date.now()).run();
  if (!claimed.meta.changes) return;
  job = (await getOutboxJob(env.DB, id))!;
  let payload: OutboundMailInput;
  try {
    const object = await env.ATTACHMENTS.get(job.payload_key);
    if (!object) throw new Error('Missing payload');
    payload = await object.json<OutboundMailInput>();
  } catch {
    await setState(env.DB, job, job.attempts < MAX_ATTEMPTS ? 'retry' : 'failed', 'Saved message could not be read. Delivery was not attempted.');
    return;
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE outbox_jobs SET first_attempt_at = COALESCE(first_attempt_at, ?) WHERE id = ?`).bind(Date.now(), id),
    env.DB.prepare(`UPDATE emails SET status = 'sending', status_detail = NULL, updated_at = datetime('now') WHERE id = ?`).bind(job.email_id)
  ]);
  let providerId: string;
  try {
    const result = await provider.send(payload);
    if (!result.providerId) throw new Error('Provider returned no delivery identifier');
    providerId = result.providerId;
  } catch (error) {
    const state = failureState(provider.kind, error, job.attempts);
    const detail = state === 'uncertain' ? UNCERTAIN :
      error instanceof ProviderError ? error.message.slice(0, 500) : 'The mail provider could not be reached. A retry is scheduled.';
    await setState(env.DB, job, state, detail);
    await recordOperationalFailure(env.DB, 'outbound', `${provider.kind}: ${detail}`);
    return;
  }
  // Persist acceptance separately. If the Sent update fails, recovery only repairs
  // that record; it never calls the provider again for an accepted job.
  await env.DB.prepare(`UPDATE outbox_jobs SET state = 'accepted', provider_id = ?, last_error = NULL,
    lease_until = 0, updated_at = datetime('now') WHERE id = ?`).bind(providerId, id).run();
  await finalizeAccepted(env, { ...job, state: 'accepted', provider_id: providerId });
}

export async function retryOutboxJob(env: Store, provider: EmailProvider, userId: string, id: string, confirmDuplicateRisk: boolean): Promise<void> {
  const job = await getOutboxJob(env.DB, id);
  if (!job || job.user_id !== userId) throw new ProviderError(404, 'not_found', 'Outgoing message not found');
  if (!job.prepared) throw new ProviderError(409, 'not_prepared', 'This message was not fully saved. Retry from the original composer.');
  if (job.provider !== provider.kind) throw new ProviderError(409, 'provider_changed', 'Restore the original mail provider before retrying.');
  if (!['failed', 'uncertain', 'retry'].includes(job.state)) throw new ProviderError(409, 'not_retryable', 'This message cannot be retried in its current state.');
  const expiredKey = job.provider === 'resend' && job.first_attempt_at !== null && Date.now() - job.first_attempt_at >= RETRY_WINDOW_MS;
  if ((job.state === 'uncertain' || expiredKey) && !confirmDuplicateRisk) {
    throw new ProviderError(409, 'duplicate_risk', UNCERTAIN);
  }
  await env.DB.prepare(`UPDATE outbox_jobs SET state = 'pending', attempts = 0, next_attempt_at = 0,
    first_attempt_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND state = ?`)
    .bind(expiredKey ? null : job.first_attempt_at, id, job.state).run();
  await deliverOutboxJob(env, provider, id);
}

export async function flushOutbox(env: Store, provider: EmailProvider): Promise<void> {
  const expired = await env.DB.prepare(`SELECT * FROM outbox_jobs WHERE state IN ('sending', 'preparing')
    AND lease_until < ? ORDER BY created_at LIMIT 50`).bind(Date.now()).all<OutboxJob>();
  for (const job of expired.results) {
    if (job.state === 'preparing') {
      await setState(env.DB, job, 'failed', 'Saving was interrupted. No delivery was attempted. Retry from the original composer.');
    } else {
      const safe = job.provider === 'resend' && job.first_attempt_at !== null &&
        Date.now() - job.first_attempt_at < RETRY_WINDOW_MS && job.attempts < MAX_ATTEMPTS;
      await setState(env.DB, job, safe ? 'retry' : 'uncertain', safe ? 'Delivery was interrupted. A retry is scheduled.' : UNCERTAIN);
    }
  }
  const due = await env.DB.prepare(`SELECT j.id FROM outbox_jobs j LEFT JOIN emails e ON e.id = j.email_id
    WHERE (j.state IN ('pending', 'retry') AND j.next_attempt_at <= ?)
      OR (j.state = 'accepted' AND (j.payload_bytes > 0 OR e.status IN ('pending', 'sending', 'failed', 'uncertain')))
    ORDER BY j.created_at LIMIT 10`).bind(Date.now()).all<{ id: string }>();
  for (const job of due.results) {
    try { await deliverOutboxJob(env, provider, job.id); }
    catch { await recordOperationalFailure(env.DB, 'system', 'Outbox recovery could not complete a storage operation. It will be checked again.'); }
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO maintenance_state (key, value) VALUES ('outbox_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(new Date().toISOString()),
    env.DB.prepare("DELETE FROM operational_events WHERE created_at < datetime('now', '-30 days')"),
    env.DB.prepare("DELETE FROM outbound_delivery_events WHERE created_at < datetime('now', '-30 days')")
  ]);
}
