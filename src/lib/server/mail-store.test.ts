import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import { buildThreadParticipants } from './thread-participants';
import {
	countUnclassifiedInbound,
	encodeMailboxCursor,
	getMailboxCounts,
	getMailboxCursor,
	listForwardThreadMessages,
	listUnclassifiedInbound,
	UNCLASSIFIED_INBOUND_WHERE
} from './mail-store';

describe('thread participants', () => {
	test('supplies a real inbound display name', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'inbound',
					from_addr: 'jane@example.com',
					from_name: 'Jane Smith',
					to_addr: 'me@example.com'
				}
			]),
			[{ label: 'Jane Smith', address: 'jane@example.com', self: false }]
		);
	});

	test('supplies recipients for sent-only and draft threads', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'Me <me@example.com>',
					from_name: 'Me',
					to_addr: 'Jane Smith <jane@example.com>, sam@example.com'
				}
			]),
			[
				{ label: 'me', address: 'me@example.com', self: true },
				{ label: 'Jane Smith', address: 'jane@example.com', self: false },
				{ label: 'sam@example.com', address: 'sam@example.com', self: false }
			]
		);
	});

	test('enriches an address-only participant when a later message supplies a name', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'me@example.com',
					from_name: 'Me',
					to_addr: 'jane@example.com'
				},
				{
					direction: 'inbound',
					from_addr: 'jane@example.com',
					from_name: 'Jane Smith',
					to_addr: 'me@example.com'
				}
			]),
			[
				{ label: 'me', address: 'me@example.com', self: true },
				{ label: 'Jane Smith', address: 'jane@example.com', self: false }
			]
		);
	});

	test('collapses multiple sending identities into one self participant', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'first@example.com',
					from_name: 'First Mailbox',
					to_addr: 'jane@example.com'
				},
				{
					direction: 'outbound',
					from_addr: 'second@example.com',
					from_name: 'Second Mailbox',
					to_addr: 'jane@example.com'
				}
			]),
			[
				{ label: 'me', address: 'first@example.com', self: true },
				{ label: 'jane@example.com', address: 'jane@example.com', self: false }
			]
		);
	});
});

test('forward-thread lookup rejects cross-user messages and returns the owned thread oldest first', async () => {
	const rows = [
		{ id: 'newer', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-02-02' },
		{ id: 'other-user', user_id: 'user-2', thread_id: 'thread-1', created_at: '2026-01-01' },
		{ id: 'older', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-02-01' },
		{
			id: 'trashed',
			user_id: 'user-1',
			thread_id: 'thread-1',
			created_at: '2026-02-03',
			deleted_at: '2026-02-04'
		},
		{ id: 'other-thread', user_id: 'user-1', thread_id: 'thread-2', created_at: '2026-01-01' }
	] as EmailRow[];
	const db = {
		prepare(sql: string) {
			assert.match(sql, /user_id = \?/);
			assert.match(sql, /COALESCE\(thread_id, id\) = \?/);
			assert.match(sql, /deleted_at IS NULL/);
			return {
				bind(userId: string, threadId: string) {
					return {
						async all() {
							return {
								results: rows
									.filter(
										(row) =>
											row.user_id === userId &&
											(row.thread_id ?? row.id) === threadId &&
											!row.deleted_at
									)
									.sort((a, b) => a.created_at.localeCompare(b.created_at))
							};
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	assert.deepEqual(
		(await listForwardThreadMessages(db, 'user-1', 'thread-1')).map((row) => row.id),
		['older', 'newer']
	);
	assert.deepEqual(await listForwardThreadMessages(db, 'user-3', 'thread-1'), []);
});

test('mailbox cursor is a count plus latest rowid and can scope to a domain', async () => {
	const binds: unknown[][] = [];
	const db = {
		prepare(sql: string) {
			if (sql.includes('mailbox_epoch')) {
				return {
					bind(...values: unknown[]) {
						binds.push(values);
						return {
							async first() {
								return { mailbox_epoch: 0 };
							}
						};
					}
				};
			}
			assert.match(sql, /COUNT\(\*\)/);
			assert.match(sql, /MAX\(rowid\)/);
			return {
				bind(...values: unknown[]) {
					binds.push(values);
					return {
						async first() {
							return {
								message_count: values.length === 2 ? 4 : 9,
								latest_rowid: 41
							};
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	assert.equal(encodeMailboxCursor(0, 0), '0:0');
	assert.equal(await getMailboxCursor(db, 'user-1'), '9:41');
	assert.equal(await getMailboxCursor(db, 'user-1', 'domain-9'), '4:41');
	assert.deepEqual(binds, [['user-1'], ['user-1'], ['user-1', 'domain-9'], ['user-1']]);
});

test('mailbox counts keep Primary unread separate from Social and exclude spam from every tab', async () => {
	let sql = '';
	const db = {
		prepare(query: string) {
			sql = query;
			return {
				bind() {
					return {
						async first() {
							return {
								inbox: 5,
								inbox_unread: 3,
								primary_count: 3,
								primary_unread: 2,
								social: 2,
								social_unread: 1,
								promotions: 0,
								promotions_unread: 0,
								updates: 0,
								updates_unread: 0,
								forums: 0,
								forums_unread: 0,
								archive: 0,
								starred: 0,
								drafts: 0,
								sent: 0,
								trash: 0,
								spam: 4
							};
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	const counts = await getMailboxCounts(db, 'user-1');
	assert.equal(counts.primary_unread, 2);
	assert.equal(counts.social_unread, 1);
	assert.equal(counts.inbox_unread, 3);
	assert.equal(counts.spam, 4);
	assert.match(sql, /spam_at IS NULL/);
	assert.match(sql, /spam_at IS NOT NULL/);
	assert.match(sql, /category = 'primary'/);
	assert.match(sql, /category = 'social'/);
	assert.match(
		sql,
		/spam_at IS NULL AND direction = 'inbound' AND category = 'primary'/
	);
	assert.match(sql, /deleted_at IS NULL AND spam_at IS NOT NULL THEN/);
});

test('unclassified inbound mail is live inbound with no category or spam source', async () => {
	let countSql = '';
	let listSql = '';
	const binds: unknown[][] = [];
	const db = {
		prepare(query: string) {
			if (query.includes('COUNT(*)')) {
				countSql = query;
				return {
					bind(...values: unknown[]) {
						binds.push(values);
						return {
							async first() {
								return { n: 3 };
							}
						};
					}
				};
			}
			listSql = query;
			return {
				bind(...values: unknown[]) {
					binds.push(values);
					return {
						async all() {
							return { results: [] };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	assert.equal(await countUnclassifiedInbound(db, 'user-1'), 3);
	await listUnclassifiedInbound(db, 'user-1', {
		after: { createdAt: '2026-01-01 00:00:00', id: 'msg-1' },
		limit: 1
	});
	assert.match(countSql, /COUNT\(\*\)/);
	assert.match(countSql, /category_source IS NULL/);
	assert.match(countSql, /spam_source IS NULL/);
	assert.match(countSql, /direction = 'inbound'/);
	assert.match(listSql, /created_at > \? OR \(created_at = \? AND id > \?\)/);
	assert.match(listSql, /LIMIT \?/);
	assert.match(UNCLASSIFIED_INBOUND_WHERE, /status <> 'draft'/);
	assert.deepEqual(binds, [
		['user-1'],
		['user-1', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 'msg-1', 1]
	]);
});
