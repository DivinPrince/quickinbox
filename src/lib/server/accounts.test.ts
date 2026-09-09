import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import {
	parseLinkedTokens,
	resolveLinkedSessions,
	serializeLinkedTokens,
	toLinkedAccounts,
	writeLinkedTokens
} from './accounts';
import { MAX_LINKED_ACCOUNTS } from './constants';
import { hashToken } from './crypto';

type Row = {
	token_hash: string;
	session_id: string;
	id: string;
	email: string;
	name: string;
	is_admin: number;
	must_change_password: number;
	created_at: string;
	address: string | null;
};

/** Stands in for the sessions ⋈ users query: returns whichever rows match the bound hashes. */
function mockDb(rows: Row[]) {
	const calls: { sql: string; args: unknown[] }[] = [];
	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					calls.push({ sql, args });
					return {
						async all() {
							return { results: rows.filter((row) => args.includes(row.token_hash)) };
						}
					};
				}
			};
		}
	} as unknown as D1Database;
	return { db, calls };
}

async function row(token: string, user: Partial<Row> & { id: string }): Promise<Row> {
	return {
		token_hash: await hashToken(token),
		session_id: `session-${user.id}`,
		email: `${user.id}@example.com`,
		name: user.id,
		is_admin: 0,
		must_change_password: 0,
		created_at: '2026-01-01T00:00:00.000Z',
		address: null,
		...user
	};
}

describe('parseLinkedTokens', () => {
	test('reads a JSON array of tokens, dropping junk and duplicates', () => {
		assert.deepEqual(parseLinkedTokens(JSON.stringify(['a', 'b', 'a', 7, '', null])), ['a', 'b']);
	});

	test('tolerates malformed cookies', () => {
		assert.deepEqual(parseLinkedTokens(undefined), []);
		assert.deepEqual(parseLinkedTokens('not json'), []);
		assert.deepEqual(parseLinkedTokens('{"a":1}'), []);
		assert.deepEqual(parseLinkedTokens(JSON.stringify(['x'.repeat(200)])), []);
	});

	test('caps the number of accounts', () => {
		const many = Array.from({ length: MAX_LINKED_ACCOUNTS + 3 }, (_, i) => `t${i}`);
		assert.equal(parseLinkedTokens(JSON.stringify(many)).length, MAX_LINKED_ACCOUNTS);
		assert.equal(JSON.parse(serializeLinkedTokens(many)).length, MAX_LINKED_ACCOUNTS);
	});
});

describe('writeLinkedTokens', () => {
	test('removes the cookie when nothing is left, otherwise stores a deduped list', () => {
		const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
		const deleted: string[] = [];
		const cookies = {
			set(name: string, value: string, options: Record<string, unknown>) {
				set.push({ name, value, options });
			},
			delete(name: string) {
				deleted.push(name);
			}
		} as unknown as Pick<Cookies, 'set' | 'delete'>;
		const url = new URL('https://mail.example.com/inbox');

		writeLinkedTokens(cookies, [], url);
		assert.deepEqual(deleted, ['mail_accounts']);
		assert.equal(set.length, 0);

		writeLinkedTokens(cookies, ['a', 'b', 'a', ''], url);
		assert.equal(set.length, 1);
		assert.equal(set[0].name, 'mail_accounts');
		assert.deepEqual(JSON.parse(set[0].value), ['a', 'b']);
		assert.equal(set[0].options.httpOnly, true);
		assert.equal(set[0].options.secure, true);
	});
});

describe('resolveLinkedSessions', () => {
	test('returns one session per user in token order, skipping tokens that no longer resolve', async () => {
		const rows = [
			await row('tok-ada', { id: 'ada', address: 'ada@mail.example.com' }),
			await row('tok-grace', { id: 'grace' }),
			await row('tok-ada-2', { id: 'ada' })
		];
		const { db, calls } = mockDb(rows);

		const resolved = await resolveLinkedSessions(db, ['tok-grace', 'tok-ada', 'expired', 'tok-ada-2', 'tok-grace']);

		assert.equal(calls.length, 1, 'one batched query');
		assert.equal(calls[0].args.length, 4, 'duplicate tokens are hashed once');
		assert.deepEqual(
			resolved.map((session) => [session.token, session.user.id, session.address]),
			[
				['tok-grace', 'grace', null],
				['tok-ada', 'ada', 'ada@mail.example.com']
			]
		);
		assert.equal(resolved[0].sessionId, 'session-grace');
		assert.equal(resolved[1].user.email, 'ada@example.com');
	});

	test('does nothing for an empty list', async () => {
		const { db, calls } = mockDb([]);
		assert.deepEqual(await resolveLinkedSessions(db, ['', '']), []);
		assert.equal(calls.length, 0);
	});
});

describe('toLinkedAccounts', () => {
	test('puts the active account first and never lists it twice', async () => {
		const ada = {
			id: 'ada',
			email: 'ada@example.com',
			name: 'Ada',
			is_admin: true,
			must_change_password: false,
			created_at: '2026-01-01T00:00:00.000Z'
		};
		const grace = { ...ada, id: 'grace', email: 'grace@example.com', name: 'Grace', is_admin: false };

		const accounts = toLinkedAccounts({ user: ada, address: 'ada@mail.example.com' }, [
			{ token: 't1', sessionId: 's1', user: grace, address: null },
			{ token: 't2', sessionId: 's2', user: ada, address: null }
		]);

		assert.deepEqual(accounts, [
			{ id: 'ada', email: 'ada@example.com', name: 'Ada', address: 'ada@mail.example.com', current: true },
			{ id: 'grace', email: 'grace@example.com', name: 'Grace', address: null, current: false }
		]);
	});

	test('works without an active account', () => {
		assert.deepEqual(toLinkedAccounts(null, []), []);
	});
});
