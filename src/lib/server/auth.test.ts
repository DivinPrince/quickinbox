import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import { deleteUser } from './auth';

const actor: User = {
	id: 'admin-1',
	email: 'ada@example.com',
	name: 'Ada',
	is_admin: true,
	created_at: '2026-01-01T00:00:00.000Z'
};

const targetRow = {
	id: 'admin-2',
	email: 'grace@example.com',
	name: 'Grace',
	is_admin: 1,
	created_at: '2026-01-02T00:00:00.000Z'
};

/** `deleteChanges` stands in for what the guarded DELETE reports: 0 means refused. */
function mockDb(options: { storageKeys?: string[]; deleteChanges: number }) {
	const batches: string[][] = [];

	const db = {
		prepare(sql: string) {
			return {
				bind(..._args: unknown[]) {
					return {
						sql,
						async first() {
							return sql.includes('FROM users WHERE id = ?') ? targetRow : null;
						},
						async run() {
							return { meta: { changes: 0 } };
						}
					};
				}
			};
		},
		async batch(statements: { sql: string }[]) {
			batches.push(statements.map((statement) => statement.sql));
			return statements.map((statement) => ({
				results: statement.sql.includes('SELECT storage_key')
					? (options.storageKeys ?? []).map((storage_key) => ({ storage_key }))
					: [],
				meta: {
					changes: statement.sql.includes('DELETE FROM users') ? options.deleteChanges : 0
				}
			}));
		}
	} as unknown as D1Database;

	return { db, batches };
}

function mockBucket(options: { failOn?: string } = {}) {
	const deleted: string[] = [];
	const bucket = {
		async delete(key: string) {
			if (options.failOn === key) throw new Error('R2 unavailable');
			deleted.push(key);
		}
	} as unknown as R2Bucket;
	return { bucket, deleted };
}

describe('deleteUser', () => {
	test('refuses to delete the account making the request', async () => {
		const { db, batches } = mockDb({ deleteChanges: 1 });
		const { bucket, deleted } = mockBucket();

		await assert.rejects(
			() => deleteUser(db, bucket, actor, actor.id),
			/cannot delete your own account/
		);
		assert.deepEqual(batches, []);
		assert.deepEqual(deleted, []);
	});

	test('reports the last-admin refusal', async () => {
		const { db } = mockDb({ deleteChanges: 0 });
		const { bucket } = mockBucket();

		await assert.rejects(
			() => deleteUser(db, bucket, actor, targetRow.id),
			/Keep at least one admin/
		);
	});

	test('removes the R2 objects the deleted mail referenced', async () => {
		const { db } = mockDb({ storageKeys: ['att/one', 'att/two'], deleteChanges: 1 });
		const { bucket, deleted } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		assert.deepEqual(deleted.sort(), ['att/one', 'att/two']);
	});

	test('leaves R2 untouched when the delete is refused', async () => {
		const { db } = mockDb({ storageKeys: ['att/one'], deleteChanges: 0 });
		const { bucket, deleted } = mockBucket();

		await assert.rejects(() => deleteUser(db, bucket, actor, targetRow.id));
		assert.deepEqual(deleted, []);
	});

	test('still succeeds when an R2 delete fails, and purges the rest', async () => {
		// The row is already gone by this point. Throwing would report failure for
		// a deletion that happened, and the retry would say the user is missing.
		const { db } = mockDb({ storageKeys: ['att/one', 'att/two'], deleteChanges: 1 });
		const { bucket, deleted } = mockBucket({ failOn: 'att/one' });

		await assert.doesNotReject(() => deleteUser(db, bucket, actor, targetRow.id));
		assert.deepEqual(deleted, ['att/two']);
	});

	test('deletes the account and its children in a single batch', async () => {
		// D1 rolls a batch back as a unit. Splitting these leaves the account gone
		// with its mail, sessions and tokens behind if the second call fails.
		const { db, batches } = mockDb({ deleteChanges: 1 });
		const { bucket } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		assert.equal(batches.length, 1);
		assert.ok(batches[0].some((sql) => sql.includes('DELETE FROM users')));
		assert.ok(batches[0].some((sql) => sql.includes('DELETE FROM emails')));
	});

	test('enforces the last-admin rule inside the DELETE, not a preceding read', async () => {
		// A count read followed by an unconditional DELETE lets two admins delete
		// each other concurrently and leave the instance with none, so the guard
		// has to travel with the statement.
		const { db, batches } = mockDb({ deleteChanges: 1 });
		const { bucket } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		const userDelete = batches[0].find((sql) => sql.includes('DELETE FROM users'));
		assert.ok(userDelete);
		assert.match(userDelete, /SELECT COUNT\(\*\) FROM users WHERE is_admin = 1/);
	});

	test('clears every child table, for databases without cascade enforcement', async () => {
		// Older D1 databases were created without ON DELETE CASCADE enforced, so
		// the user row going away is not enough — mail, addresses, sessions,
		// tokens and push subscriptions would all survive it.
		const { db, batches } = mockDb({ deleteChanges: 1 });
		const { bucket } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		for (const table of [
			'email_attachments',
			'emails',
			'addresses',
			'sessions',
			'api_tokens',
			'push_subscriptions'
		]) {
			assert.ok(
				batches[0].some((sql) => sql.includes(`DELETE FROM ${table}`)),
				`expected the batch to delete from ${table}`
			);
		}

		assert.ok(
			batches[0].some((sql) => sql.includes('UPDATE domains SET catchall_user_id = NULL')),
			'expected the catch-all reference to be cleared'
		);

		// Attachment metadata is reachable only through emails, so it must go first.
		assert.ok(
			batches[0].findIndex((sql) => sql.includes('DELETE FROM email_attachments')) <
				batches[0].findIndex((sql) => sql.includes('DELETE FROM emails WHERE')),
			'email_attachments must be cleared before the emails it hangs off'
		);
	});

	test('gates child cleanup on the account actually being gone', async () => {
		// The child statements share a transaction with the guarded delete, so
		// without this gate a refused delete would strip an account that survives.
		const { db, batches } = mockDb({ deleteChanges: 1 });
		const { bucket } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		const userDeleteAt = batches[0].findIndex((sql) => sql.includes('DELETE FROM users'));
		const children = batches[0].slice(userDeleteAt + 1);
		assert.ok(children.length > 0);
		for (const sql of children) {
			assert.match(sql, /NOT EXISTS \(SELECT 1 FROM users WHERE id = \?\)/);
		}
	});

	test('reads the attachment keys inside the deletion transaction', async () => {
		// Reading them beforehand leaves a window where inbound delivery commits an
		// attachment whose metadata this deletes without collecting its object.
		const { db, batches } = mockDb({ storageKeys: ['att/one'], deleteChanges: 1 });
		const { bucket, deleted } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		assert.equal(batches.length, 1);
		assert.match(batches[0][0], /SELECT storage_key FROM email_attachments/);
		assert.ok(
			batches[0].findIndex((sql) => sql.includes('SELECT storage_key')) <
				batches[0].findIndex((sql) => sql.includes('DELETE FROM users')),
			'the key read must precede the delete inside the transaction'
		);
		assert.deepEqual(deleted, ['att/one']);
	});

	test('works without a bucket configured', async () => {
		const { db } = mockDb({ storageKeys: ['att/one'], deleteChanges: 1 });

		await assert.doesNotReject(() => deleteUser(db, undefined, actor, targetRow.id));
	});
});
