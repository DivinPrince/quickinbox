import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDns, readMaintenance } from './maintenance';
import { mailArchive } from './mail-export';
import { insertAttachments } from './attachments';
import { insertEmail } from './mail-store';
import { listTrustedImageSenders, trustImagesForMessage } from './image-privacy';
import { testStore } from './testing/store';
import { GET as exportRoute } from '../../routes/api/admin/export/+server';
import { load as maintenancePage } from '../../routes/admin/maintenance/+page.server';

test('image permissions belong to the signed-in user and an owned inbound message', async () => {
  const s = testStore();
  const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'Alice <ALICE@example.test>', to: s.user.email, subject: 'Picture' });
  assert.equal(await trustImagesForMessage(s.db, 'user-2', id), false);
  assert.deepEqual(await listTrustedImageSenders(s.db, s.user.id), []);
  assert.equal(await trustImagesForMessage(s.db, s.user.id, id), true);
  assert.deepEqual(await listTrustedImageSenders(s.db, s.user.id), ['alice@example.test']);
  assert.deepEqual(await listTrustedImageSenders(s.db, 'user-2'), []);
});

test('mail archive includes attachment bytes and completion counts, but excludes credentials', async () => {
  const s = testStore();
  const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'friend@example.test', to: s.user.email, subject: 'Export me', bodyText: 'message contents' });
  await insertAttachments(s.db, s.bucket, id, [{ filename: 'note.txt', type: 'text/plain', content: btoa('attachment contents') }]);
  const rows = [];
  for await (const line of mailArchive(s.db, s.bucket)) rows.push(JSON.parse(line));
  assert.equal(rows.at(-1).type, 'complete');
  assert.equal(rows.at(-1).counts.emails, 1);
  assert.equal(rows.at(-1).missingAttachments, 0);
  const attachment = rows.find((row) => row.type === 'email_attachments');
  assert.equal(atob(attachment.data.content_base64), 'attachment contents');
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|password_hash|token_hash|mfa_secret/);
  const health = await readMaintenance(s.db, s.bucket);
  assert.equal(health.mail.messages, 1);
  assert.equal(health.attachments.bytes, 'attachment contents'.length);
  assert.equal(health.outboxWorkerHealthy, false);
});

test('export reports missing attachments instead of silently claiming a complete backup', async () => {
  const s = testStore();
  const id = await insertEmail(s.db, { userId: s.user.id, direction: 'inbound', from: 'friend@example.test', to: s.user.email, subject: 'Missing file' });
  await insertAttachments(s.db, s.bucket, id, [{ filename: 'note.txt', type: 'text/plain', content: btoa('attachment contents') }]);
  s.objects.clear();
  const rows = [];
  for await (const line of mailArchive(s.db, s.bucket)) rows.push(JSON.parse(line));
  assert.equal(rows.at(-1).missingAttachments, 1);
});

test('maintenance and export reject non-admin accounts before accessing data', async () => {
  const locals = { user: { is_admin: false } };
  const response = await exportRoute({ locals } as never);
  assert.equal(response.status, 403);
  await assert.rejects(Promise.resolve(maintenancePage({ locals } as never)), (error: unknown) => {
    return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403);
  });
});

test('DNS checks distinguish missing records, failures, split TXT strings and duplicate SPF', async () => {
  const fake = (body: unknown, status = 200) => (async () => Response.json(body, { status }));
  assert.deepEqual(await checkDns('example.test', 'TXT', 'v=spf1', fake({ Status: 0, Answer: [{ type: 16, data: '"v=spf1 " "include:example.test -all"' }] })),
    { state: 'published', records: ['v=spf1 include:example.test -all'] });
  assert.equal((await checkDns('example.test', 'MX', '', fake({ Status: 3 }))).state, 'missing');
  assert.equal((await checkDns('example.test', 'MX', '', fake({ Status: 2 }))).state, 'unknown');
  assert.equal((await checkDns('example.test', 'MX', '', fake({}, 503))).state, 'unknown');
  assert.equal((await checkDns('example.test', 'TXT', 'v=spf1', fake({ Status: 0, Answer: [{ type: 16, data: '"v=spf1 -all"' }, { type: 16, data: '"v=spf1 ~all"' }] }))).state, 'multiple');
});
