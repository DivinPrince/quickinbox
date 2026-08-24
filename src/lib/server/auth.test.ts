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

function mockDb(options: { storageKeys?: string[]; deleteChanges: number }) {
	const deleteStatements: string[] = [];
	const batched: string[] = [];

	const db = {
		prepare(sql: string) {
			return {
				bind(..._args: unknown[]) {
					return {
						sql,
						async first() {
							return sql.includes('FROM users WHERE id = ?') ? targetRow : null;
						},
						async all() {
							if (sql.includes('FROM email_attachments')) {
								return {
									results: (options.storageKeys ?? []).map((storage_key) => ({ storage_key }))
								};
							}
							return { results: [] };
						},
						async run() {
							if (sql.includes('DELETE FROM users')) {
								deleteStatements.push(sql);
								return { meta: { changes: options.deleteChanges } };
							}
							return { meta: { changes: 0 } };
						}
					};
				}
			};
		},
		async batch(statements: { sql: string }[]) {
			batched.push(...statements.map((statement) => statement.sql));
			return statements.map(() => ({ meta: { changes: 0 } }));
		}
	} as unknown as D1Database;

	return { db, deleteStatements, batched };
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
		const { db, deleteStatements } = mockDb({ deleteChanges: 1 });
		const { bucket, deleted } = mockBucket();

		await assert.rejects(
			() => deleteUser(db, bucket, actor, actor.id),
			/cannot delete your own account/
		);
		assert.deepEqual(deleteStatements, []);
		assert.deepEqual(deleted, []);
	});

	test('removes the R2 objects the deleted mail referenced', async () => {
		const { db } = mockDb({ storageKeys: ['att/one', 'att/two'], deleteChanges: 1 });
		const { bucket, deleted } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		assert.deepEqual(deleted.sort(), ['att/one', 'att/two']);
	});

	test('leaves R2 untouched when the delete is refused', async () => {
		// changes = 0 means the last-admin guard in the statement rejected it.
		const { db } = mockDb({ storageKeys: ['att/one'], deleteChanges: 0 });
		const { bucket, deleted } = mockBucket();

		await assert.rejects(
			() => deleteUser(db, bucket, actor, targetRow.id),
			/Keep at least one admin/
		);
		assert.deepEqual(deleted, []);
	});

	test('enforces the last-admin rule inside the DELETE, not a preceding read', async () => {
		// A count read followed by an unconditional DELETE lets two admins delete
		// each other concurrently and leave the instance with none. The guard has
		// to travel with the statement, so assert it is actually there.
		const { db, deleteStatements } = mockDb({ deleteChanges: 1 });
		const { bucket } = mockBucket();

		await deleteUser(db, bucket, actor, targetRow.id);

		assert.equal(deleteStatements.length, 1);
		assert.match(deleteStatements[0], /SELECT COUNT\(\*\) FROM users WHERE is_admin = 1/);
	});

	test('still succeeds when an R2 delete fails, and purges the rest', async () => {
		// The D1 delete has already committed by this point. Throwing here would
		// report failure for a deletion that happened, and the retry would say
		// the user no longer exists.
		const { db } = mockDb({ storageKeys: ['att/one', 'att/two'], deleteChanges: 1 });
		const { bucket, deleted } = mockBucket({ failOn: 'att/one' });

		await assert.doesNotReject(() => deleteUser(db, bucket, actor, targetRow.id));
		assert.deepEqual(deleted, ['att/two']);
	});

	test('clears child rows explicitly, for databases without cascade enforcement', async () => {
		// Older D1 databases were created without ON DELETE CASCADE enforced, so
		// the user row going away is not enough — mail, addresses, sessions,
		// tokens and push subscriptions would all be left behind.
		const { db, batched } = mockDb({ deleteChanges: 1 });
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
				batched.some((sql) => sql.includes(`DELETE FROM ${table}`)),
				`expected the cleanup batch to delete from ${table}`
			);
		}

		assert.ok(
			batched.some((sql) => sql.includes('UPDATE domains SET catchall_user_id = NULL')),
			'expected the catch-all reference to be cleared'
		);

		// Attachment metadata is reachable only through emails, so it has to go first.
		assert.ok(
			batched.findIndex((sql) => sql.includes('DELETE FROM email_attachments')) <
				batched.findIndex((sql) => sql.includes('DELETE FROM emails WHERE')),
			'email_attachments must be cleared before the emails it hangs off'
		);
	});

	test('leaves child rows alone when the delete is refused', async () => {
		const { db, batched } = mockDb({ deleteChanges: 0 });
		const { bucket } = mockBucket();

		await assert.rejects(() => deleteUser(db, bucket, actor, targetRow.id));
		assert.deepEqual(batched, []);
	});

	test('works without a bucket configured', async () => {
		const { db } = mockDb({ storageKeys: ['att/one'], deleteChanges: 1 });

		await assert.doesNotReject(() => deleteUser(db, undefined, actor, targetRow.id));
	});
});
