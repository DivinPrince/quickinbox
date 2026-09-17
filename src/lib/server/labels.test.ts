import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLabelWriteBody } from './labels';

test('parseLabelWriteBody rejects non-objects and mistyped fields', () => {
	assert.deepEqual(parseLabelWriteBody(null, 'create'), { ok: false, error: 'Invalid body' });
	assert.deepEqual(parseLabelWriteBody([], 'create'), { ok: false, error: 'Invalid body' });
	assert.deepEqual(parseLabelWriteBody({ name: {} }, 'create'), {
		ok: false,
		error: 'Name is required'
	});
	assert.deepEqual(parseLabelWriteBody({ name: 'Work', autoInstructions: 1 }, 'create'), {
		ok: false,
		error: 'Invalid auto-apply description'
	});
});

test('parseLabelWriteBody accepts a valid create payload', () => {
	assert.deepEqual(parseLabelWriteBody({ name: '  Work  ', color: '#2563eb', autoEnabled: true }, 'create'), {
		ok: true,
		fields: { name: 'Work', color: '#2563eb', autoEnabled: true }
	});
});

test('parseLabelWriteBody allows a name-less update', () => {
	assert.deepEqual(parseLabelWriteBody({ autoEnabled: false }, 'update'), {
		ok: true,
		fields: { autoEnabled: false }
	});
});
