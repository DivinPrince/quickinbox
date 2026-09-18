import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMailSender } from './send';

test('lost and malformed send responses retain the request key until acknowledged', async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    keys.push(new Headers(options.headers).get('Idempotency-Key')!);
    if (keys.length === 1) throw new TypeError('Connection lost');
    if (keys.length === 2) return new Response('Interrupted response');
    if (keys.length === 3) return Response.json({ error: 'Unavailable' }, { status: 503 });
    return Response.json({ ok: true, state: 'accepted' });
  }) as typeof fetch;
  try {
    const send = createMailSender();
    const options = { method: 'POST', body: JSON.stringify({ subject: 'Hello' }) };
    await assert.rejects(send('/api/mail', options), /Connection lost/);
    await assert.rejects(send('/api/mail', options), SyntaxError);
    assert.equal((await send('/api/mail', options)).status, 503);
    assert.equal((await send('/api/mail', options)).status, 200);
    assert.equal(new Set(keys).size, 1);
    await send('/api/mail', options);
    assert.notEqual(keys[4], keys[0]);
  } finally { globalThis.fetch = original; }
});

test('changed messages get new request keys while retaining caller headers', async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Content-Type'), 'application/json');
    keys.push(headers.get('Idempotency-Key')!);
    return Response.json({ error: 'Unavailable' }, { status: 503 });
  }) as typeof fetch;
  try {
    const send = createMailSender();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'first' };
    await send('/api/mail', options);
    await send('/api/mail', { ...options, body: 'changed' });
    await send('/api/mail/message', { ...options, body: 'changed' });
    assert.equal(new Set(keys).size, 3);
  } finally { globalThis.fetch = original; }
});
