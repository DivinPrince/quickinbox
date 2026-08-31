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
				subject: 'Re: Inbox test',
				from: 'sender@external.test',
				to: 'support@example.org',
				domainId: 'example.org'
			}
		);

		assert.equal(threadId, 'earlier-thread');
	});
});

test('an intentional new conversation does not use subject fallback', async () => {
	const db = {
		prepare() {
			throw new Error('subject lookup must not run');
		}
	} as unknown as D1Database;

	const threadId = await resolveThreadId(db, 'user-1', {
		emailId: 'forward-id',
		subject: 'Fwd: Existing subject',
		from: 'me@example.com',
		to: 'recipient@example.com',
		subjectMatch: false
	});

	assert.equal(threadId, 'forward-id');
});
