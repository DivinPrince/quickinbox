import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS_PER_EMAIL,
	MAX_TOTAL_ATTACHMENT_BYTES
} from './constants';
import {
	assertOutboundAttachments,
	assertTotalAttachmentBytes,
	resolveReplyFromAddress
} from './outbox';

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
