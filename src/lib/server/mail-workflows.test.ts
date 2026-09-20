import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testStore } from './testing/store';
import { persistDraft, readSavedDraft } from './drafts';
import { deleteDraft, getMailboxCounts, insertEmail, listMailbox, setEmailFlags } from './mail-store';
import { searchMail, searchFilters } from './search';
import { cleanupMail, undoCleanup, wakeSnoozedMail } from './mail-cleanup';
import { saveSenderRule } from './sender-rules';
import { createLabel } from './labels';
import { createInlineImage } from '../mail/inline-images';
import { sendAndStore } from './outbox';
import { createCloudflareProvider } from './providers/cloudflare-provider';
import { listAttachments } from './attachments';

const content = { id: 'draft-test', revision: 0, saveId: 'save-1', fromAddressId: 'address-1', to: 'friend@example.test', cc: '', bcc: '', subject: 'Draft invoice', text: 'Remember me', html: '<p>Remember me</p>', attachments: [{ filename: 'receipt.txt', type: 'text/plain', content: btoa('receipt contents') }] };
const incoming = { userId: 'user-1', direction: 'inbound' as const, from: 'billing@example.test', to: 'me@example.test', subject: 'Invoice September', bodyText: 'The monthly subscription invoice is attached.' };

test('an image-only draft reopens and sends with matching inline bytes and Sent-folder metadata', async () => {
  const s = testStore();
  const image = await createInlineImage(new File([new Uint8Array([137, 80, 78, 71])], 'screen.png', { type: 'image/png' }));
  const html = `<img src="cid:${image.contentId}" alt="screen.png" style="max-width:100%;height:auto">`;
  await persistDraft(s.env, s.user, { ...content, html, text: '', attachments: [image] });
  const draft = await readSavedDraft(s.env, s.user.id, content.id);
  assert.equal(draft?.body_html, html);
  assert.deepEqual(draft?.attachments, [image]);
  let delivered = false;
  const provider = createCloudflareProvider({ async send(payload) {
    assert.ok(payload.html?.includes(`cid:${image.contentId}`));
    assert.ok(!payload.html?.includes('data:image/'));
    const part = payload.attachments?.[0];
    assert.equal(part?.disposition, 'inline');
    assert.equal(part?.contentId, image.contentId);
    assert.deepEqual(new Uint8Array(part!.content as ArrayBuffer), new Uint8Array([137, 80, 78, 71]));
    delivered = true;
    return { messageId: 'inline-message' };
  } }, 'example.test');
  const result = await sendAndStore(s.env, provider, s.user, { fromAddress: s.from, to: content.to, subject: content.subject, html: draft!.body_html, attachments: draft!.attachments });
  assert.ok(delivered);
  const stored = await listAttachments(s.db, result.emailId);
  assert.equal(stored[0].content_id, image.contentId);
  assert.equal(stored[0].content_disposition, 'inline');
});

test('draft snapshots preserve attachments, replay lost responses, and reject stale tabs', async () => {
  const s = testStore();
  assert.deepEqual(await persistDraft(s.env, s.user, content), { id: content.id, revision: 1 });
  assert.equal((await readSavedDraft(s.env, s.user.id, content.id))?.attachments[0].content, content.attachments[0].content);
  assert.deepEqual(await persistDraft(s.env, s.user, content), { id: content.id, revision: 1 });
  await assert.rejects(persistDraft(s.env, s.user, { ...content, saveId: 'different-tab', text: 'Stale' }), /another tab/);
  await persistDraft(s.env, s.user, { ...content, revision: 1, saveId: 'save-2', attachments: [] });
  assert.deepEqual((await readSavedDraft(s.env, s.user.id, content.id))?.attachments, []);
  assert.equal(s.objects.size, 1);
  assert.equal(await readSavedDraft(s.env, 'user-2', content.id), null);
  await assert.rejects(persistDraft(s.env, { ...s.user, id: 'user-2' }, { ...content, revision: 2 }), /not found/);
});

test('failed R2 writes preserve the last complete draft, and discarded drafts cannot be resurrected by stale saves', async () => {
  const s = testStore();
  await persistDraft(s.env, s.user, content);
  s.faults.put = () => { throw new Error('R2 interrupted'); };
  await assert.rejects(persistDraft(s.env, s.user, { ...content, revision: 1, saveId: 'save-2', text: 'Not saved' }), /R2 interrupted/);
  assert.equal((await readSavedDraft(s.env, s.user.id, content.id))?.body_text, content.text);
  s.faults.put = undefined;
  await deleteDraft(s.db, s.user.id, content.id, s.bucket);
  assert.equal(s.objects.size, 0);
  await assert.rejects(persistDraft(s.env, s.user, { ...content, revision: 1, saveId: 'save-2' }), /another tab/);
  assert.equal(await readSavedDraft(s.env, s.user.id, content.id), null);
});

test('draft save transactions keep the old pointer if the database fails after R2 storage', async () => {
  const s = testStore(); await persistDraft(s.env, s.user, content);
  s.faults.sql = (sql) => { if (sql.startsWith('UPDATE emails SET from_addr')) throw new Error('D1 interrupted'); };
  await assert.rejects(persistDraft(s.env, s.user, { ...content, revision: 1, saveId: 'save-2', text: 'New' }), /D1 interrupted/);
  s.faults.sql = undefined;
  assert.equal((await readSavedDraft(s.env, s.user.id, content.id))?.body_text, content.text);
  assert.equal((await persistDraft(s.env, s.user, { ...content, revision: 1, saveId: 'save-2', text: 'New' })).revision, 2);
});

test('indexed search filters by ownership, addresses, date, and attachments, including saved drafts', async () => {
  const s = testStore();
  const id = await insertEmail(s.db, { ...incoming, cc: 'accounting@example.test' });
  await insertEmail(s.db, { ...incoming, userId: 'user-2' });
  await persistDraft(s.env, s.user, content);
  const search = (q: string) => searchMail(s.db, s.user.id, searchFilters(new URLSearchParams(q)));
  assert.equal((await search('q=invoice')).total, 2);
  assert.equal((await search('q=invoice&from=billing&to=accounting')).results[0].id, id);
  assert.equal((await search('q=invoice&attachments=1')).results[0].id, content.id);
  assert.equal((await search('q=invoice&after=2099-01-01')).total, 0);
  assert.equal((await search('q=%22%29+OR+1%3D1+--')).total, 0);
  await s.db.prepare('UPDATE emails SET body_text = ?, subject = ? WHERE id = ?').bind('A unicorn arrived', 'Changed', id).run();
  assert.equal((await search('q=unicorn')).total, 1);
  await s.db.prepare('DELETE FROM emails WHERE id = ?').bind(id).run();
  assert.equal((await search('q=unicorn')).total, 0);
});

test('search paginates all results and includes archived mail while hiding trash by default', async () => {
  const s = testStore();
  for (let i = 0; i < 29; i++) await insertEmail(s.db, { ...incoming, id: `message-${i}`, subject: `Invoice ${i}`, subjectMatch: false });
  await setEmailFlags(s.db, s.user.id, ['message-0'], { archived: true });
  await setEmailFlags(s.db, s.user.id, ['message-1'], { trashed: true });
  const filters = searchFilters(new URLSearchParams('q=invoice'));
  const first = await searchMail(s.db, s.user.id, filters);
  const second = await searchMail(s.db, s.user.id, filters, 2);
  assert.equal(first.total, 28); assert.equal(first.results.length, 25); assert.equal(second.results.length, 3);
  assert.equal(new Set([...first.results, ...second.results].map((row) => row.id)).size, 28);
  assert.equal((await searchMail(s.db, s.user.id, { ...filters, includeHidden: true })).total, 29);
});

test('undo restores the prior archive state and refuses to overwrite a newer action', async () => {
  const s = testStore(); const id = await insertEmail(s.db, incoming);
  await cleanupMail(s.db, s.user.id, 'archive', [id], 'archive-1');
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).total, 0);
  assert.equal(await undoCleanup(s.db, s.user.id, 'archive-1'), 1);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).total, 1);
  await cleanupMail(s.db, s.user.id, 'archive', [id], 'archive-2');
  await cleanupMail(s.db, s.user.id, 'trash', [id], 'trash-1');
  assert.equal(await undoCleanup(s.db, s.user.id, 'archive-2'), 0);
  assert.equal(await undoCleanup(s.db, s.user.id, 'trash-1'), 1);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'archive' })).total, 1);
});

test('cleanup retries are idempotent and undo is scoped to the account and expiry', async () => {
  const s = testStore(); const id = await insertEmail(s.db, incoming);
  await cleanupMail(s.db, s.user.id, 'trash', [id], 'trash-1');
  await cleanupMail(s.db, s.user.id, 'trash', [id], 'trash-1');
  assert.equal(await undoCleanup(s.db, s.user.id, 'trash-1'), 1);
  await cleanupMail(s.db, s.user.id, 'trash', [id], 'trash-1');
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'trash' })).total, 0);
  await cleanupMail(s.db, s.user.id, 'trash', [id], 'trash-2');
  await assert.rejects(undoCleanup(s.db, 'user-2', 'trash-2'), /no longer/);
  s.sqlite.exec("UPDATE mail_action_history SET expires_at = '2000-01-01'");
  await assert.rejects(undoCleanup(s.db, s.user.id, 'trash-2'), /no longer/);
});

test('trashing and undoing a saved draft preserves its complete attachment snapshot', async () => {
  const s = testStore(); await persistDraft(s.env, s.user, content);
  await cleanupMail(s.db, s.user.id, 'trash', [content.id], 'trash-draft');
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'drafts' })).total, 0);
  assert.equal(await undoCleanup(s.db, s.user.id, 'trash-draft'), 1);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'drafts' })).total, 1);
  assert.equal((await readSavedDraft(s.env, s.user.id, content.id))?.attachments[0].content, content.attachments[0].content);
});

test('a delayed snooze acknowledgement can be retried after its wake-up time', async () => {
  const s = testStore(); const id = await insertEmail(s.db, incoming);
  const until = new Date(Date.now() + 3600_000).toISOString();
  await cleanupMail(s.db, s.user.id, 'snooze', [id], 'snooze-retry', until);
  const now = Date.now;
  try {
    Date.now = () => now() + 7200_000;
    assert.equal((await cleanupMail(s.db, s.user.id, 'snooze', [id], 'snooze-retry', until)).affected, 0);
  } finally { Date.now = now; }
});

test('snoozed conversations leave the inbox and unread counts, then wake without losing their flags', async () => {
  const s = testStore(); const id = await insertEmail(s.db, incoming);
  await cleanupMail(s.db, s.user.id, 'snooze', [id], 'snooze-1', new Date(Date.now() + 3600_000).toISOString());
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).total, 0);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'snoozed' })).total, 1);
  assert.equal((await getMailboxCounts(s.db, s.user.id)).inbox_unread, 0);
  s.sqlite.exec("UPDATE emails SET snoozed_until = '2000-01-01'");
  await wakeSnoozedMail(s.db);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).total, 1);
  assert.equal((await getMailboxCounts(s.db, s.user.id)).inbox_unread, 1);
});

test('new inbound replies wake a snoozed conversation, and snooze undo restores its old archive state', async () => {
  const s = testStore(); const id = await insertEmail(s.db, incoming);
  await setEmailFlags(s.db, s.user.id, [id], { archived: true });
  await cleanupMail(s.db, s.user.id, 'snooze', [id], 'snooze-1', new Date(Date.now() + 3600_000).toISOString());
  await undoCleanup(s.db, s.user.id, 'snooze-1');
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'archive' })).total, 1);
  await cleanupMail(s.db, s.user.id, 'snooze', [id], 'snooze-2', new Date(Date.now() + 3600_000).toISOString());
  await insertEmail(s.db, { ...incoming, replyToEmailId: id });
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'snoozed' })).total, 0);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).total, 1);
});

test('sender rules label and archive matching new inbound mail without crossing accounts or affecting outbound mail', async () => {
  const s = testStore(); const label = await createLabel(s.db, s.user.id, { name: 'Invoices' });
  const existing = await insertEmail(s.db, incoming);
  await saveSenderRule(s.db, s.user.id, { sender: 'Billing <BILLING@example.test>', subject_contains: 'invoice', label_id: label.id, archive: true });
  const id = await insertEmail(s.db, { ...incoming, subjectMatch: false });
  assert.equal(s.sqlite.query<{ label_id: string }, [string]>('SELECT label_id FROM email_labels WHERE email_id = ?').get(id)?.label_id, label.id);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'archive' })).total, 1);
  assert.equal((await listMailbox(s.db, s.user.id, { view: 'inbox' })).threads[0].latest_id, existing);
  await assert.rejects(saveSenderRule(s.db, 'user-2', { sender: incoming.from, label_id: label.id }), /Unknown label/);
  const outbound = await insertEmail(s.db, { ...incoming, direction: 'outbound' });
  assert.equal(s.sqlite.query('SELECT * FROM email_labels WHERE email_id = ?').get(outbound), null);
});
