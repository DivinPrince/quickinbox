import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MailAddress, User } from '$lib/types';
import {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS_PER_EMAIL,
	MAX_TOTAL_ATTACHMENT_BYTES
} from './constants';
import { ProviderError, type EmailProvider } from './email-provider';
import {
	assertOutboundAttachments,
	assertTotalAttachmentBytes,
	persistableAddressId,
	resolveReplyFromAddress,
	sendAndStore
} from './outbox';
import { SendAttemptError } from './send-attempts';
import type { OutboundMailInput } from './send-mail';
import { createTestDb, insertTestUser } from './test-db';

const user: User = {
	id: 'user-1',
	email: 'ada@example.com',
	name: 'Ada',
	is_admin: false,
	must_change_password: false,
	created_at: '2026-01-01T00:00:00.000Z'
};

type AddressRow = {
	id: string;
	user_id: string;
	domain_id: string;
	domain_name: string;
	address: string;
	label: string | null;
	is_default: number;
	signature: string | null;
	created_at: string;
};

type DomainRow = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	sending_enabled: number;
	receiving_enabled: number;
	catchall_user_id: string | null;
	created_at: string;
	synced_at: string | null;
};

function mockDb(input: { addresses: AddressRow[]; domains: DomainRow[] }): D1Database {
	return {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					const statement = {
						async all() {
							if (sql.includes('FROM addresses')) {
								const userId = args[0];
								return {
									results: input.addresses.filter((row) => row.user_id === userId)
								};
							}
							return { results: [] };
						},
						async first() {
							if (sql.includes('FROM domains')) {
								const name = String(args[0] ?? '').toLowerCase();
								return input.domains.find((row) => row.name === name) ?? null;
							}
							return null;
						}
					};
					return statement;
				}
			};
		}
	} as unknown as D1Database;
}

const defaultAddress: AddressRow = {
	id: 'addr-default',
	user_id: user.id,
	domain_id: 'dom-1',
	domain_name: 'example.com',
	address: 'ada@example.com',
	label: 'Office',
	is_default: 1,
	signature: null,
	created_at: user.created_at
};

const inbound = {
	direction: 'inbound' as const,
	to_addr: 'Ada <hello@example.com>',
	from_addr: 'Sam <sam@other.test>'
};

describe('resolveReplyFromAddress', () => {
	test('uses the saved mailbox and its From name', async () => {
		const hello: AddressRow = {
			...defaultAddress,
			id: 'addr-hello',
			address: 'hello@example.com',
			label: 'Support',
			is_default: 0
		};
		const identity = await resolveReplyFromAddress(
			mockDb({ addresses: [defaultAddress, hello], domains: [] }),
			user,
			inbound
		);
		assert.equal(identity?.address, 'hello@example.com');
		assert.equal(identity?.label, 'Support');
	});

	test('sends catch-all replies from the received mailbox', async () => {
		const identity = await resolveReplyFromAddress(
			mockDb({
				addresses: [
					{
						...defaultAddress,
						domain_id: 'dom-other',
						domain_name: 'other.test',
						address: 'ada@other.test'
					}
				],
				domains: [
					{
						id: 'dom-1',
						name: 'example.com',
						status: 'verified',
						region: null,
						sending_enabled: 1,
						receiving_enabled: 1,
						catchall_user_id: user.id,
						created_at: user.created_at,
						synced_at: null
					}
				]
			}),
			user,
			inbound
		);
		assert.equal(identity?.address, 'hello@example.com');
		assert.equal(identity?.label, null);
	});

	test('sends from the received mailbox when the user already has an address on that domain', async () => {
		const identity = await resolveReplyFromAddress(
			mockDb({
				addresses: [defaultAddress],
				domains: [
					{
						id: 'dom-1',
						name: 'example.com',
						status: 'verified',
						region: null,
						sending_enabled: 1,
						receiving_enabled: 1,
						catchall_user_id: null,
						created_at: user.created_at,
						synced_at: null
					}
				]
			}),
			user,
			inbound
		);
		assert.equal(identity?.address, 'hello@example.com');
	});

	test('falls back to the default address when the mailbox cannot send', async () => {
		const identity = await resolveReplyFromAddress(
			mockDb({
				addresses: [defaultAddress],
				domains: [
					{
						id: 'dom-1',
						name: 'example.com',
						status: 'verified',
						region: null,
						sending_enabled: 1,
						receiving_enabled: 1,
						catchall_user_id: 'someone-else',
						created_at: user.created_at,
						synced_at: null
					}
				]
			}),
			user,
			{
				direction: 'inbound',
				to_addr: 'unknown@other.test',
				from_addr: 'sam@other.test'
			}
		);
		assert.equal(identity?.address, 'ada@example.com');
		assert.equal(identity?.label, 'Office');
	});

	test('returns null when the user has no sending identity', async () => {
		const identity = await resolveReplyFromAddress(
			mockDb({ addresses: [], domains: [] }),
			user,
			inbound
		);
		assert.equal(identity, null);
	});
});

describe('persistableAddressId', () => {
	test('keeps a real address id', () => {
		assert.equal(persistableAddressId('addr-hello'), 'addr-hello');
	});

	test('drops the synthetic id a catch-all reply carries', () => {
		// `emails.address_id` references `addresses(id)`; storing the synthetic
		// id raised SQLITE_CONSTRAINT_FOREIGNKEY after the mail had already been
		// handed to the provider.
		assert.equal(persistableAddressId('reply:hello@example.com'), null);
	});

	test('treats a missing id as null', () => {
		assert.equal(persistableAddressId(null), null);
		assert.equal(persistableAddressId(undefined), null);
		assert.equal(persistableAddressId(''), null);
	});
});

describe('outbound attachment totals', () => {
	test('accepts the exact limit and rejects an oversized combined forward', () => {
		assert.doesNotThrow(() => assertTotalAttachmentBytes(MAX_TOTAL_ATTACHMENT_BYTES));
		assert.throws(
			() => assertTotalAttachmentBytes(MAX_TOTAL_ATTACHMENT_BYTES + 1),
			/Attachments exceed the total size limit/
		);
	});

	test('rejects attachment count and per-file size before sending', () => {
		const attachment = {
			filename: 'note.txt',
			type: 'text/plain',
			content: Buffer.from('ok').toString('base64')
		};
		assert.throws(
			() =>
				assertOutboundAttachments(
					Array.from({ length: MAX_ATTACHMENTS_PER_EMAIL + 1 }, () => attachment)
				),
			/Maximum 5 attachments allowed/
		);
		assert.doesNotThrow(() =>
			assertOutboundAttachments(
				Array.from({ length: MAX_ATTACHMENTS_PER_EMAIL + 1 }, () => attachment),
				true
			)
		);

		assert.throws(
			() =>
				assertOutboundAttachments([
					{
						filename: 'large.bin',
						type: 'application/octet-stream',
						content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64')
					}
				]),
			/exceeds 5MB limit/
		);
	});
});

describe('sendAndStore with an idempotency key', () => {
	const from: MailAddress = {
		id: 'addr-1',
		user_id: user.id,
		domain_id: 'dom-1',
		domain_name: 'example.com',
		address: 'ada@example.com',
		label: 'Ada',
		signature: null,
		is_default: true,
		created_at: user.created_at
	};

	function setup(send: (input: OutboundMailInput) => Promise<{ providerId: string }>) {
		const { db, sqlite } = createTestDb();
		insertTestUser(sqlite, user.id);
		sqlite.query(`INSERT INTO domains (id, name) VALUES ('dom-1', 'example.com')`).run();
		sqlite
			.query(
				`INSERT INTO addresses (id, user_id, domain_id, address, is_default)
				 VALUES ('addr-1', ?, 'dom-1', 'ada@example.com', 1)`
			)
			.run(user.id);
		const sent: OutboundMailInput[] = [];
		const provider = {
			kind: 'cloudflare',
			async send(input: OutboundMailInput) {
				sent.push(input);
				return send(input);
			}
		} as unknown as EmailProvider;
		const env = { DB: db, ATTACHMENTS: { put: async () => null } as unknown as R2Bucket };
		const outbound = () =>
			sqlite.query(`SELECT id FROM emails WHERE direction = 'outbound'`).all() as { id: string }[];
		return { env, provider, sent, outbound, sqlite };
	}

	const message = {
		fromAddress: from,
		to: 'sam@other.test',
		subject: 'Hello',
		text: 'Are we still on for Thursday?',
		idempotencyKey: 'retry-key-0001'
	};

	test('a retry returns the first send instead of emailing again', async () => {
		const { env, provider, sent, outbound } = setup(async () => ({ providerId: 'provider-1' }));

		const first = await sendAndStore(env, provider, user, message);
		const retry = await sendAndStore(env, provider, user, message);

		assert.equal(sent.length, 1);
		assert.equal(retry.emailId, first.emailId);
		assert.equal(retry.providerId, 'provider-1');
		assert.equal(outbound().length, 1);
	});

	const refused = () => new ProviderError(400, 'E_SENDER_NOT_VERIFIED', 'Sender not verified');

	test('a send the provider refused can be retried under the same key', async () => {
		let calls = 0;
		const { env, provider, sent } = setup(async () => {
			calls += 1;
			if (calls === 1) throw refused();
			return { providerId: 'provider-1' };
		});

		await assert.rejects(sendAndStore(env, provider, user, message), /Sender not verified/);
		await sendAndStore(env, provider, user, message);

		assert.equal(sent.length, 2);
		assert.ok(sent[0].idempotencyKey);
		assert.equal(sent[1].idempotencyKey, sent[0].idempotencyKey);
	});

	test('an ambiguous failure never sends again under the same key', async () => {
		for (const failure of [
			new Error('Network connection lost'),
			// Cloudflare binding errors without a code are wrapped this way.
			new ProviderError(400, 'send_failed', 'Internal error'),
			new ProviderError(502, 'resend_error', 'Bad gateway')
		]) {
			const { env, provider, sent } = setup(async () => {
				throw failure;
			});

			await assert.rejects(sendAndStore(env, provider, user, message));
			await assert.rejects(
				sendAndStore(env, provider, user, message),
				(error: unknown) =>
					error instanceof SendAttemptError && error.code === 'send_outcome_unknown'
			);
			assert.equal(sent.length, 1, failure.message);
		}
	});

	test('a mistake caught before sending does not lock the key', async () => {
		const { env, provider, sent } = setup(async () => ({ providerId: 'provider-1' }));

		await assert.rejects(sendAndStore(env, provider, user, { ...message, to: 'not-an-address' }));
		await sendAndStore(env, provider, user, message);

		assert.equal(sent.length, 1);
	});

	test('a send that went out but failed to save is not sent again', async () => {
		const { env, provider, sent, sqlite } = setup(async () => ({ providerId: 'provider-1' }));
		sqlite.exec('ALTER TABLE emails RENAME TO emails_unavailable');

		await assert.rejects(sendAndStore(env, provider, user, message));
		await assert.rejects(
			sendAndStore(env, provider, user, message),
			(error: unknown) => error instanceof SendAttemptError && error.code === 'already_sent'
		);
		assert.equal(sent.length, 1);
	});

	test('a refused send retried after an edit gets a fresh provider key', async () => {
		let calls = 0;
		const { env, provider, sent } = setup(async () => {
			calls += 1;
			if (calls === 1) throw refused();
			return { providerId: 'provider-1' };
		});

		await assert.rejects(sendAndStore(env, provider, user, message), /Sender not verified/);
		await sendAndStore(env, provider, user, { ...message, to: 'sam@fixed.test' });

		assert.equal(sent.length, 2);
		assert.notEqual(sent[1].idempotencyKey, sent[0].idempotencyKey);
	});

	test('an attachment sent inline instead of attached is a different message', async () => {
		const { env, provider, sent } = setup(async () => ({ providerId: 'provider-1' }));
		const file = { filename: 'logo.png', type: 'image/png', content: 'aGVsbG8=' };

		await sendAndStore(env, provider, user, { ...message, attachments: [file] });
		await assert.rejects(
			sendAndStore(env, provider, user, {
				...message,
				attachments: [{ ...file, disposition: 'inline', contentId: 'logo' }]
			}),
			SendAttemptError
		);
		assert.equal(sent.length, 1);
	});

	test('reusing a key for a different message is refused without sending', async () => {
		const { env, provider, sent } = setup(async () => ({ providerId: 'provider-1' }));

		await sendAndStore(env, provider, user, message);
		await assert.rejects(
			sendAndStore(env, provider, user, { ...message, text: 'Actually, Friday?' }),
			SendAttemptError
		);
		assert.equal(sent.length, 1);
	});

	test('without a key, every call sends', async () => {
		const { env, provider, sent, outbound } = setup(async () => ({ providerId: 'provider-1' }));
		const { idempotencyKey: _unused, ...unkeyed } = message;

		await sendAndStore(env, provider, user, unkeyed);
		await sendAndStore(env, provider, user, unkeyed);

		assert.equal(sent.length, 2);
		assert.equal(outbound().length, 2);
	});
});
