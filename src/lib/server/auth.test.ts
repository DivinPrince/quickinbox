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

	const db = {
		prepare(sql: string) {
			return {
				bind(..._args: unknown[]) {
					return {
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
		}
	} as unknown as D1Database;

	return { db, deleteStatements };
}

function mockBucket() {
	const deleted: string[] = [];
	const bucket = {
		async delete(key: string) {
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

	test('works without a bucket configured', async () => {
		const { db } = mockDb({ storageKeys: ['att/one'], deleteChanges: 1 });

		await assert.doesNotReject(() => deleteUser(db, undefined, actor, targetRow.id));
	});
});
