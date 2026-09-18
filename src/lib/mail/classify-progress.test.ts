import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClassifyCursor, classifyExistingBatchSize } from './classify-progress';

test('parseClassifyCursor requires a createdAt and id', () => {
	assert.equal(parseClassifyCursor(null), null);
	assert.equal(parseClassifyCursor({ createdAt: '2026-01-01', id: '' }), null);
	assert.deepEqual(parseClassifyCursor({ createdAt: '2026-01-01 00:00:00', id: 'msg-1' }), {
		createdAt: '2026-01-01 00:00:00',
		id: 'msg-1'
	});
});

test('classifyExistingBatchSize takes the mailbox in one Worker request', () => {
	assert.equal(classifyExistingBatchSize(0), 0);
	assert.equal(classifyExistingBatchSize(3), 3);
	assert.equal(classifyExistingBatchSize(110), 110);
	assert.equal(classifyExistingBatchSize(400), 150);
});
