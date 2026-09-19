import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { safeDownloadName } from './client.ts';

describe('safeDownloadName', () => {
	test('strips directory components and absolute paths', () => {
		assert.equal(safeDownloadName('../../.ssh/authorized_keys'), 'authorized_keys');
		assert.equal(safeDownloadName('/tmp/payload'), 'payload');
		assert.equal(safeDownloadName('C:\\Windows\\win.ini'), 'win.ini');
		assert.equal(safeDownloadName('invoice.pdf'), 'invoice.pdf');
	});

	test('falls back when the name is empty or a traversal residue', () => {
		assert.equal(safeDownloadName(''), 'attachment');
		assert.equal(safeDownloadName('..'), 'attachment');
		assert.equal(safeDownloadName('/'), 'attachment');
	});
});


test('attachment download never overwrites an existing file or symlink', async () => {
 const { mkdtemp, writeFile, readFile, symlink, rm } = await import('node:fs/promises');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const { saveAttachmentFile } = await import('./client');
 const dir = await mkdtemp(join(tmpdir(), 'quickinbox-test-'));
 try {
  const target = join(dir, '.zshrc');
  await writeFile(target, 'original');
  await assert.rejects(saveAttachmentFile(target, new Uint8Array([1])), { code: 'EEXIST' });
  await symlink(target, join(dir, 'link'));
  await assert.rejects(saveAttachmentFile(join(dir, 'link'), new Uint8Array([1])), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'original');
  await saveAttachmentFile(join(dir, 'new'), new Uint8Array([7]));
  assert.deepEqual([...await readFile(join(dir, 'new'))], [7]);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
