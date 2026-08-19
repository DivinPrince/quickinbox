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
