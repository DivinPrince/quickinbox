import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { configuredTypesafeKey } from './typesafe-classify';
import { classifyNextExisting } from './classify';

test('deploy-button TypeSafe placeholders do not count as configured', () => {
	assert.equal(configuredTypesafeKey(undefined), undefined);
	assert.equal(configuredTypesafeKey(''), undefined);
	assert.equal(configuredTypesafeKey('REPLACE_WITH_YOUR_TYPESAFE_API_KEY'), undefined);
	assert.equal(configuredTypesafeKey('  real-key  '), 'real-key');
});

test('classifyNextExisting reports complete when the unclassified window is empty', async () => {
	const db = {
		prepare(sql: string) {
			return {
				bind() {
					return {
						async first() {
							return sql.includes('COUNT(*)') ? { n: 2 } : null;
						},
						async all() {
							return { results: [] };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	assert.deepEqual(await classifyNextExisting(db, 'key', 'user-1', null), {
		enabled: true,
		applied: false,
		subject: null,
		remaining: 2,
		cursor: null,
		complete: true
	});
});
