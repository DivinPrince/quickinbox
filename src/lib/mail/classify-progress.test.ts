import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClassifyCursor } from './classify-progress';

test('parseClassifyCursor requires a createdAt and id', () => {
	assert.equal(parseClassifyCursor(null), null);
	assert.equal(parseClassifyCursor({ createdAt: '2026-01-01', id: '' }), null);
	assert.deepEqual(parseClassifyCursor({ createdAt: '2026-01-01 00:00:00', id: 'msg-1' }), {
		createdAt: '2026-01-01 00:00:00',
		id: 'msg-1'
	});
});
