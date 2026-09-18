import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendAndStore } from './outbox';
import { deliverOutboxJob, flushOutbox, getOutboxJob, retryOutboxJob } from './durable-outbox';
import { ProviderError, type EmailProvider } from './email-provider';
import { testStore } from './testing/store';
import { getMailboxCursor, updateEmailStatusByProviderId } from './mail-store';

const message = { to: 'friend@example.test', subject: 'Hello', text: 'A saved message',
  attachments: [{ filename: 'note.txt', type: 'text/plain', content: btoa('hello attachment') }] };
function provider(kind: EmailProvider['kind'], send: EmailProvider['send']): EmailProvider {
  return { kind, send, async listDomains() { return []; }, async getDomain() { throw new Error('unused'); } };
}

test('stores message and attachments before delivery; repeated HTTP requests send once', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('resend', async (input) => {
    sends++;
    assert.equal(s.sqlite.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM emails').get()!.n, 1);
    assert.equal(s.sqlite.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM email_attachments').get()!.n, 1);
    assert.equal(input.attachments?.[0].content, message.attachments[0].content);
    assert.match(input.idempotencyKey!, /^quickinbox\//);
    return { providerId: 'provider-1' };
  });
  const input = { ...message, fromAddress: s.from, idempotencyKey: 'request-1' };
  const first = await sendAndStore(s.env, p, s.user, input);
  const second = await sendAndStore(s.env, p, s.user, input);
  assert.equal(first.state, 'accepted');
  assert.equal(first.emailId, second.emailId);
  assert.equal(sends, 1);
  assert.equal(s.sqlite.query<{ provider_id: string }, []>('SELECT provider_id FROM emails').get()!.provider_id, 'provider-1');
  assert.equal([...s.objects.keys()].filter((key) => key.startsWith('outbox/')).length, 0);
});

test('attachment storage failure cannot send; retrying preparation does not duplicate attachments', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('cloudflare', async () => { sends++; return { providerId: 'provider-1' }; });
  s.faults.put = (key) => { if (!key.startsWith('outbox/')) throw new Error('R2 unavailable'); };
  const input = { ...message, fromAddress: s.from, idempotencyKey: 'request-1' };
  await assert.rejects(sendAndStore(s.env, p, s.user, input), /R2 unavailable/);
  assert.equal(sends, 0);
  await flushOutbox(s.env, p);
  assert.equal(sends, 0);
  s.faults.put = undefined;
  assert.equal((await sendAndStore(s.env, p, s.user, input)).state, 'accepted');
  assert.equal(sends, 1);
  assert.equal(s.sqlite.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM emails').get()!.n, 1);
  assert.equal(s.sqlite.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM email_attachments').get()!.n, 1);
});

test('transient Resend failures reuse the exact payload and idempotency key', async () => {
  const s = testStore();
  const payloads: string[] = [];
  const p = provider('resend', async (input) => {
    payloads.push(JSON.stringify(input));
    if (payloads.length === 1) throw new ProviderError(503, 'unavailable', 'Try later');
    return { providerId: 'provider-1' };
  });
  const first = await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
  assert.equal(first.state, 'retry');
  s.sqlite.exec('UPDATE outbox_jobs SET next_attempt_at = 0');
  await flushOutbox(s.env, p);
  assert.equal((await getOutboxJob(s.db, first.emailId))?.state, 'accepted');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0], payloads[1]);
});

test('ambiguous Cloudflare failures never automatically resend and require explicit duplicate acknowledgement', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('cloudflare', async () => { sends++; throw new Error('Connection dropped after acceptance'); });
  const result = await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
  assert.equal(result.state, 'uncertain');
  await flushOutbox(s.env, p);
  assert.equal(sends, 1);
  await assert.rejects(retryOutboxJob(s.env, p, s.user.id, result.emailId, false), /may have accepted/);
  await assert.rejects(retryOutboxJob(s.env, p, 'user-2', result.emailId, true), /not found/);
  await retryOutboxJob(s.env, p, s.user.id, result.emailId, true);
  assert.equal(sends, 2);
});

test('a Sent-folder update failure is repaired without another provider call', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('cloudflare', async () => {
    sends++;
    s.faults.sql = (sql) => { if (sql.startsWith('UPDATE emails SET provider_id')) throw new Error('D1 interrupted'); };
    return { providerId: 'provider-1' };
  });
  const result = await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
  assert.equal(result.state, 'accepted');
  s.faults.sql = undefined;
  await flushOutbox(s.env, p);
  assert.equal(sends, 1);
  assert.equal(s.sqlite.query<{ status: string }, []>('SELECT status FROM emails').get()!.status, 'accepted');
});

test('expired keys and expired Cloudflare leases become uncertain without resending', async () => {
  for (const kind of ['resend', 'cloudflare'] as const) {
    const s = testStore();
    let sends = 0;
    const p = provider(kind, async () => { sends++; throw new ProviderError(429, 'E_RATE_LIMIT_EXCEEDED', 'Rate limit'); });
    const result = await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
    s.sqlite.exec(`UPDATE outbox_jobs SET state = '${kind === 'resend' ? 'retry' : 'sending'}', next_attempt_at = 0, lease_until = 0, first_attempt_at = 1`);
    await flushOutbox(s.env, p);
    assert.equal((await getOutboxJob(s.db, result.emailId))?.state, 'uncertain');
    assert.equal(sends, 1);
  }
});

test('concurrent delivery workers only claim a message once', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('resend', async () => { sends++; throw new ProviderError(429, 'rate_limit', 'Rate limit'); });
  const result = await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
  s.sqlite.exec('UPDATE outbox_jobs SET next_attempt_at = 0');
  await Promise.all([deliverOutboxJob(s.env, p, result.emailId), deliverOutboxJob(s.env, p, result.emailId)]);
  assert.equal(sends, 2);
});

test('reusing a key for changed content is rejected before a second send', async () => {
  const s = testStore();
  let sends = 0;
  const p = provider('resend', async () => { sends++; return { providerId: 'provider-1' }; });
  await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from, idempotencyKey: 'same' });
  await assert.rejects(sendAndStore(s.env, p, s.user, { ...message, text: 'Different', fromAddress: s.from, idempotencyKey: 'same' }), /different message/);
  assert.equal(sends, 1);
});

test('an early delivery webhook is preserved when the send response arrives later', async () => {
  const s = testStore();
  const p = provider('resend', async () => {
    await updateEmailStatusByProviderId(s.db, 'early-provider-id', 'delivered');
    return { providerId: 'early-provider-id' };
  });
  const before = await getMailboxCursor(s.db, s.user.id);
  await sendAndStore(s.env, p, s.user, { ...message, fromAddress: s.from });
  assert.equal(s.sqlite.query<{ status: string }, []>('SELECT status FROM emails').get()!.status, 'delivered');
  const accepted = await getMailboxCursor(s.db, s.user.id);
  assert.notEqual(before, accepted);
  await updateEmailStatusByProviderId(s.db, 'early-provider-id', 'complained', 'Complaint received');
  assert.notEqual(await getMailboxCursor(s.db, s.user.id), accepted);
});
