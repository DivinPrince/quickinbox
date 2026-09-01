import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import {
	completeFirstLogin,
	deleteUser,
	getAuthenticatedSession,
	setUserAdmin
} from './auth';
import { hashPassword } from './crypto';

const actor: User = {
	id: 'admin-1',
	email: 'ada@example.com',
	name: 'Ada',
	is_admin: true,
	must_change_password: false,
	created_at: '2026-01-01T00:00:00.000Z'
};

const targetRow = {
	id: 'admin-2',
	email: 'grace@example.com',
	name: 'Grace',
	is_admin: 1,
	must_change_password: 0,
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
			'pairing_codes',
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


/** Records the write statements so the guard can be asserted on. */
function mockRoleDb(options: { updateChanges: number; target?: unknown }) {
	const writes: string[] = [];

	const db = {
		prepare(sql: string) {
			return {
				bind(..._args: unknown[]) {
					return {
						async first() {
							if (!sql.includes('FROM users WHERE id = ?')) return null;
							return 'target' in options ? options.target : targetRow;
						},
						async run() {
							writes.push(sql);
							return { meta: { changes: options.updateChanges } };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	return { db, writes };
}

describe('setUserAdmin', () => {
	test('refuses to change the role of the account making the request', async () => {
		const { db, writes } = mockRoleDb({ updateChanges: 1 });

		await assert.rejects(
			() => setUserAdmin(db, actor, actor.id, false),
			/cannot change your own role/
		);
		assert.deepEqual(writes, []);
	});

	test('rejects an unknown user', async () => {
		const { db, writes } = mockRoleDb({ updateChanges: 1, target: null });

		await assert.rejects(() => setUserAdmin(db, actor, 'nobody', true), /User not found/);
		assert.deepEqual(writes, []);
	});

	test('promotes without a guard', async () => {
		const { db, writes } = mockRoleDb({ updateChanges: 1 });

		await setUserAdmin(db, actor, targetRow.id, true);

		assert.equal(writes.length, 1);
		assert.match(writes[0], /SET is_admin = 1/);
		assert.doesNotMatch(writes[0], /COUNT\(\*\)/);
	});

	test('carries the last-admin guard on the demotion itself', async () => {
		// Reading the count first and updating after lets two admins demote each
		// other concurrently, both seeing two admins, leaving nobody.
		const { db, writes } = mockRoleDb({ updateChanges: 1 });

		await setUserAdmin(db, actor, targetRow.id, false);

		assert.equal(writes.length, 1);
		assert.match(writes[0], /SET is_admin = 0/);
		assert.match(writes[0], /SELECT COUNT\(\*\) FROM users WHERE is_admin = 1/);
	});

	test('refuses to demote the last admin', async () => {
		// The guard matched nothing, so the row was left alone.
		const { db } = mockRoleDb({ updateChanges: 0 });

		await assert.rejects(
			() => setUserAdmin(db, actor, targetRow.id, false),
			/Keep at least one admin/
		);
	});
});

describe('completeFirstLogin', () => {
	test('updates the name and password while clearing the setup requirement', async () => {
		const statements: string[] = [];
		const temporaryPasswordHash = await hashPassword('temporary-password');
		const db = {
			prepare(sql: string) {
				return {
					bind(..._args: unknown[]) {
						return {
							sql,
							async first() {
								return { password_hash: temporaryPasswordHash };
							},
							async run() {
								statements.push(sql);
								return { meta: { changes: 1 } };
							}
						};
					}
				};
			},
			async batch(batch: { sql: string }[]) {
				statements.push(...batch.map((statement) => statement.sql));
				return batch.map(() => ({ meta: { changes: 1 }, results: [] }));
			}
		} as unknown as D1Database;

		await completeFirstLogin(db, actor.id, {
			name: 'Ada Lovelace',
			password: 'correct-horse'
		});

		assert.match(statements[0], /must_change_password = 0/);
		assert.match(statements[0], /must_change_password = 1/);
		const sessionDelete = statements.find((sql) => sql.includes('DELETE FROM sessions'));
		const tokenDelete = statements.find((sql) => sql.includes('DELETE FROM api_tokens'));
		assert.match(sessionDelete ?? '', /password_hash = \?/);
		assert.match(tokenDelete ?? '', /password_hash = \?/);
	});

	test('refuses a repeated completion attempt', async () => {
		const db = {
			prepare() {
				return {
					bind() {
						return {
							async first() {
								return null;
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		await assert.rejects(
			() =>
				completeFirstLogin(db, actor.id, {
					name: actor.name,
					password: 'correct-horse'
				}),
			/setup is already complete/
		);
	});

	test('requires a password different from the temporary password', async () => {
		const temporaryPasswordHash = await hashPassword('temporary-password');
		const db = {
			prepare() {
				return {
					bind() {
						return {
							async first() {
								return { password_hash: temporaryPasswordHash };
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		await assert.rejects(
			() =>
				completeFirstLogin(db, actor.id, {
					name: actor.name,
					password: 'temporary-password'
				}),
			/different from the temporary password/
		);
	});
});

describe('getAuthenticatedSession', () => {
	test('does not rewrite a recent zoned mobile activity timestamp', async () => {
		let updates = 0;
		const db = {
			prepare(sql: string) {
				return {
					bind(..._args: unknown[]) {
						return {
							async first() {
								return {
									session_id: 'session-1',
									device_platform: 'ios',
									last_seen_at: new Date().toISOString(),
									id: actor.id,
									email: actor.email,
									name: actor.name,
									is_admin: 1,
									must_change_password: 0,
									created_at: actor.created_at
								};
							},
							async run() {
								if (sql.includes('UPDATE sessions')) updates += 1;
								return { meta: { changes: 1 } };
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		const session = await getAuthenticatedSession(db, 'mobile-token');

		assert.equal(session?.sessionId, 'session-1');
		assert.equal(session?.isMobile, true);
		assert.equal(updates, 0);
	});
});
