import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { labelsForEmails, parseLabelWriteBody } from './labels';

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

test('label lookup stays under the D1 bound-parameter limit on a large page', async () => {
	// D1 rejects statements with more than 100 bound parameters, and a page of
	// long threads can hold far more messages than that.
	const binds: number[] = [];
	const db = {
		prepare() {
			return {
				bind(...values: unknown[]) {
					binds.push(values.length);
					return {
						async all() {
							return {
								results: values.map((emailId) => ({
									email_id: emailId,
									id: 'l1',
									name: 'Work',
									color: '#000',
									slug: 'work'
								}))
							};
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	const ids = Array.from({ length: 250 }, (_, i) => `email-${i}`);
	const labels = await labelsForEmails(db, ids);

	assert.ok(binds.length > 1);
	assert.ok(binds.every((count) => count <= 100));
	assert.equal(labels.size, 250);
	assert.equal(labels.get('email-249')?.[0].slug, 'work');
});
