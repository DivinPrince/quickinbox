import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDraftSaver } from './drafts';

test('autosave drains edits made during a request without parallel writes', async () => {
  const writes: Record<string, unknown>[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const saver = createDraftSaver({ id: 'draft', revision: 0, onState() {}, request: (async (_url: unknown, options: RequestInit) => {
    writes.push(JSON.parse(String(options.body)));
    if (writes.length === 1) await pending;
    return Response.json({ id: 'draft', revision: writes.length });
  }) as typeof fetch });
  saver.update(JSON.stringify({ text: 'first' }));
  const first = saver.flush();
  saver.update(JSON.stringify({ text: 'second', attachments: [{ content: 'abc' }] }));
  const second = saver.flush();
  release();
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(writes.length, 2); assert.equal(writes[1].revision, 1); assert.equal(writes[1].text, 'second');
  assert.equal(saver.dirty, false);
});

test('a lost acknowledgement retries the original save before writing newer content', async () => {
  const writes: Record<string, unknown>[] = [];
  const states: string[] = [];
  const saver = createDraftSaver({ id: 'draft', revision: 0, onState(state) { states.push(state); }, request: (async (_url: unknown, options: RequestInit) => {
    writes.push(JSON.parse(String(options.body)));
    if (writes.length === 1) throw new TypeError('Connection lost');
    return Response.json({ id: 'draft', revision: writes.length - 1 });
  }) as typeof fetch });
  saver.update(JSON.stringify({ text: 'original' }));
  assert.equal(await saver.flush(), false); assert.equal(saver.dirty, true);
  saver.update(JSON.stringify({ text: 'newer' }));
  assert.equal(await saver.flush(), true);
  assert.deepEqual(writes[0], writes[1]); assert.equal(writes[2].text, 'newer');
  assert.equal(writes[2].revision, 1); assert.ok(states.includes('error'));
});
