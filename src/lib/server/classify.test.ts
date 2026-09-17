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

test('classifyNextExisting judges a window in one batch call', async () => {
	const emails = [
		{
			id: 'e1',
			thread_id: 'e1',
			from_addr: 'a@x.com',
			from_name: 'A',
			to_addr: 'you@x.com',
			subject: 'Hello',
			body_text: 'Hi',
			body_html: null,
			created_at: '2026-09-01 00:00:00'
		},
		{
			id: 'e2',
			thread_id: 'e2',
			from_addr: 'b@x.com',
			from_name: 'B',
			to_addr: 'you@x.com',
			subject: 'Sale',
			body_text: 'Off',
			body_html: null,
			created_at: '2026-09-01 00:01:00'
		}
	];
	let countCalls = 0;
	const db = {
		prepare(sql: string) {
			return {
				bind() {
					return {
						async first() {
							if (sql.includes('COUNT(*)')) {
								countCalls += 1;
								return { n: countCalls === 1 ? emails.length : 0 };
							}
							return null;
						},
						async all() {
							if (sql.includes('FROM labels')) return { results: [] };
							if (sql.includes('FROM sender_prefs')) return { results: [] };
							if (sql.includes("category_source = 'user'")) return { results: [] };
							if (sql.includes('email_attachments')) return { results: [] };
							if (sql.includes('FROM emails')) return { results: emails };
							return { results: [] };
						},
						async run() {
							return { success: true, meta: { changes: 1 } };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	let batchSize = 0;
	const step = await classifyNextExisting(db, 'key', 'user-1', null, {
		batchJudge: async (_key, inputs) => {
			batchSize = inputs.length;
			return inputs.map((input) => ({
				isSpam: 0.05,
				isPhishing: 0.01,
				category: {
					choice: input.subject === 'Sale' ? 'promotions' : 'primary',
					confidence: 0.9
				},
				labels: []
			}));
		}
	});

	assert.equal(batchSize, 2);
	assert.equal(step.applied, true);
	assert.equal(step.complete, true);
	assert.equal(step.remaining, 0);
});

test('classifyNextExisting does not look up sender prefs per message', async () => {
	const emails = [
		{
			id: 'e1',
			thread_id: 'e1',
			from_addr: 'a@x.com',
			from_name: 'A',
			to_addr: 'you@x.com',
			subject: 'Hello',
			body_text: 'Hi',
			body_html: null,
			created_at: '2026-09-01 00:00:00'
		}
	];
	const firstSql: string[] = [];
	let countCalls = 0;
	const db = {
		prepare(sql: string) {
			return {
				bind() {
					return {
						async first() {
							firstSql.push(sql);
							if (sql.includes('COUNT(*)')) {
								countCalls += 1;
								return { n: countCalls === 1 ? 1 : 0 };
							}
							return null;
						},
						async all() {
							if (sql.includes('FROM emails') && sql.includes('LIMIT ?')) {
								return { results: emails };
							}
							return { results: [] };
						},
						async run() {
							return { success: true, meta: { changes: 1 } };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	await classifyNextExisting(db, 'key', 'user-1', null, {
		batchJudge: async (_key, inputs) =>
			inputs.map(() => ({
				isSpam: 0.05,
				isPhishing: 0.01,
				category: { choice: 'primary', confidence: 0.9 },
				labels: []
			}))
	});

	assert.ok(firstSql.every((sql) => sql.includes('COUNT(*)')));
	assert.equal(firstSql.some((sql) => sql.includes('sender_prefs')), false);
});
