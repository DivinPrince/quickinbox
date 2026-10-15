import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { chunkIds } from './d1-chunks';
import { resolveInboundRoute } from './domains';
import { labelsForEmails, rememberSenders, setThreadLabels } from './labels';
import { deleteEmailsPermanently } from './mail-store';

/** Fails a statement the way D1 does once it binds more than 100 parameters. */
function strictD1() {
	const statements: { sql: string; binds: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...binds: unknown[]) {
					if (binds.length > 100) {
						throw new Error('D1_ERROR: too many SQL variables');
					}
					statements.push({ sql, binds });
					// Echo ids back so ownership checks treat every id as owned.
					const rows = binds
						.filter((value) => typeof value === 'string' && value.startsWith('email-'))
						.map((id) => ({ id, from_addr: `${id}@sender.test` }));
					return {
						async all() {
							return { results: sql.includes('FROM labels') ? [{ id: 'l1' }] : rows };
						},
						async run() {
							return { meta: { changes: 0 } };
						},
						async first() {
							return null;
						}
					};
				}
			};
		}
	} as unknown as D1Database;
	return { db, statements };
}

const ids = Array.from({ length: 250 }, (_, i) => `email-${i}`);

test('chunkIds splits into groups no larger than the limit', () => {
	const groups = chunkIds(ids);
	assert.equal(groups.length, 4);
	assert.ok(groups.every((group) => group.length <= 80));
	assert.deepEqual(groups.flat(), ids);
});

test('bulk label, spam and delete actions accept more than 100 messages', async () => {
	const { db, statements } = strictD1();

	await labelsForEmails(db, ids);
	assert.equal(await setThreadLabels(db, 'user-1', ids, ['l1']), 250);
	await rememberSenders(db, 'user-1', ids, 'spam');

	const deleted: string[] = [];
	const bucket = { delete: async (key: string) => void deleted.push(key) } as unknown as R2Bucket;
	assert.equal(await deleteEmailsPermanently(db, bucket, 'user-1', ids), 250);

	assert.ok(statements.every((statement) => statement.binds.length <= 100));
	const removed = statements
		.filter((statement) => statement.sql.startsWith('DELETE FROM emails'))
		.flatMap((statement) => statement.binds.slice(1));
	assert.deepEqual(removed, ids);
});

test('inbound routing accepts a mailing with more than 100 recipients', async () => {
	const { db } = strictD1();
	const recipients = Array.from({ length: 150 }, (_, i) => `person${i}@example.com`);
	assert.equal(await resolveInboundRoute(db, recipients), null);
});
