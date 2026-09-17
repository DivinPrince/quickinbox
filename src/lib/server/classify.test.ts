import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { classifyNextExisting } from './classify';

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
