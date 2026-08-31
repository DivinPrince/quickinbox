import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { resolveThreadId } from './threads';

/** Every lookup carries the domain predicate and only matches inside it. */
function matchingDb(expectedDomain: string, match: { id: string; thread_id: string }) {
	return {
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async first() {
							assert.match(sql, /AND domain_id = \?/);
							return values.includes(expectedDomain) ? match : null;
						}
					};
				}
			};
		}
	} as unknown as D1Database;
}

describe('domain-scoped threading', () => {
	test('does not merge the same subject and participant across domains', async () => {
		const emailId = 'second-domain-message';
		const threadId = await resolveThreadId(
			matchingDb('example.com', { id: 'first-message', thread_id: 'first-thread' }),
			'user-1',
			{
				emailId,
				direction: 'inbound',
				subject: 'Inbox test',
				from: 'sender@external.test',
				to: 'support@example.org',
				domainId: 'example.org',
				replyToEmailId: 'first-message',
				inReplyTo: 'first-message-id'
			}
		);

		assert.equal(threadId, emailId);
	});

	test('still merges matching messages inside the same domain', async () => {
		const threadId = await resolveThreadId(
			matchingDb('example.org', { id: 'earlier-message', thread_id: 'earlier-thread' }),
			'user-1',
			{
				emailId: 'new-reply',
				direction: 'inbound',
				subject: 'Re: Inbox test',
				from: 'sender@external.test',
				to: 'support@example.org',
				domainId: 'example.org'
			}
		);

		assert.equal(threadId, 'earlier-thread');
	});
});

describe('subject fallback', () => {
	test('does not merge a forward through the sender mailbox when disabled', async () => {
		let subjectLookupRan = false;
		const db = {
			prepare(sql: string) {
				subjectLookupRan = subjectLookupRan || sql.includes('AND thread_key = ?');
				return {
					bind() {
						return {
							async first() {
								return {
									id: 'alice-message',
									thread_id: 'alice-thread'
								};
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		const threadId = await resolveThreadId(db, 'user-1', {
			emailId: 'forward-to-bob',
			direction: 'outbound',
			subject: 'Fwd: Quarterly figures',
			from: 'me@example.com',
			to: 'bob@example.com',
			domainId: 'example.com',
			subjectMatch: false
		});

		assert.equal(threadId, 'forward-to-bob');
		assert.equal(subjectLookupRan, false);
	});

	test('matches a reply to a forward through the external sender', async () => {
		const db = {
			prepare(sql: string) {
				return {
					bind(...values: unknown[]) {
						return {
							async first() {
								if (!sql.includes('AND thread_key = ?')) return null;
								assert.equal(values.at(-1), 'bob@example.com');
								assert.equal(values.includes('me@example.com'), false);
								return {
									id: 'forward-to-bob',
									thread_id: 'forward-to-bob'
								};
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		const threadId = await resolveThreadId(db, 'user-1', {
			emailId: 'reply-from-bob',
			direction: 'inbound',
			subject: 'Re: Fwd: Quarterly figures',
			from: 'bob@example.com',
			to: 'me@example.com',
			domainId: 'example.com'
		});

		assert.equal(threadId, 'forward-to-bob');
	});

	test('does not match a reply to a forward through the user mailbox', async () => {
		const db = {
			prepare(sql: string) {
				return {
					bind(...values: unknown[]) {
						return {
							async first() {
								if (!sql.includes('AND thread_key = ?')) return null;
								assert.equal(values.at(-1), 'bob@example.com');
								assert.equal(values.includes('me@example.com'), false);
								return null;
							}
						};
					}
				};
			}
		} as unknown as D1Database;

		const threadId = await resolveThreadId(db, 'user-1', {
			emailId: 'reply-from-bob',
			direction: 'inbound',
			subject: 'Re: Fwd: Quarterly figures',
			from: 'bob@example.com',
			to: 'me@example.com',
			domainId: 'example.com'
		});

		assert.equal(threadId, 'reply-from-bob');
	});
});
