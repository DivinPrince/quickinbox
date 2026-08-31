import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import { buildThreadParticipants } from './thread-participants';
import { listForwardThreadMessages } from './mail-store';

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
