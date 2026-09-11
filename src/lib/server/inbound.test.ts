import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from './constants';
import { storeInboundAttachments } from './inbound';
import type { ResendClient } from './resend';

type ListedAttachment = {
	id: string;
	filename: string;
	content_type: string;
	size?: number;
	download_url?: string;
};

function mockEnv(options: { failPut?: boolean } = {}) {
	const stored: string[] = [];
	const bucket = {
		async put(key: string) {
			if (options.failPut) throw new Error('R2 unavailable');
			stored.push(key);
		}
	} as unknown as R2Bucket;

	const db = {
		prepare() {
			return {
				bind() {
					return { async run() {} };
				}
			};
		}
	} as unknown as D1Database;

	return { env: { DB: db, ATTACHMENTS: bucket }, stored };
}

function mockClient(attachments: ListedAttachment[], bytesFor: (a: ListedAttachment) => number) {
	return {
		async listReceivedAttachments() {
			return attachments;
		},
		async downloadAttachment(url: string) {
			const match = attachments.find((a) => a.download_url === url)!;
			return new Uint8Array(bytesFor(match));
		}
	} as unknown as ResendClient;
}

function listed(count: number, size = 10): ListedAttachment[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `att-${i}`,
		filename: `file-${i}.txt`,
		content_type: 'text/plain',
		size,
		download_url: `https://resend.test/att-${i}`
	}));
}

describe('storeInboundAttachments (Resend)', () => {
	test('returns how many attachments were stored', async () => {
		const { env, stored } = mockEnv();
		const count = await storeInboundAttachments(env, mockClient(listed(3), () => 10), 'msg-1', 'email-1');
		assert.equal(count, 3);
		assert.equal(stored.length, 3);
	});

	test('does not count an attachment the provider listed but never delivered', async () => {
		// No download_url — nothing to fetch, so nothing is stored, and announcing
		// it would promise the reader a file the mailbox does not have.
		const { env } = mockEnv();
		const attachments = [...listed(1), { id: 'att-x', filename: 'ghost.txt', content_type: 'text/plain' }];
		const count = await storeInboundAttachments(env, mockClient(attachments, () => 10), 'msg-1', 'email-1');
		assert.equal(count, 1);
	});

	test('does not count attachments skipped for size', async () => {
		const { env } = mockEnv();
		const big = listed(1, MAX_ATTACHMENT_BYTES + 1);
		const count = await storeInboundAttachments(env, mockClient(big, () => 10), 'msg-1', 'email-1');
		assert.equal(count, 0);
	});

	test('does not count an attachment whose body turns out to be oversized', async () => {
		// `size` from the listing is advisory; the downloaded body is the truth.
		const { env } = mockEnv();
		const attachments = listed(1, 10);
		const count = await storeInboundAttachments(
			env,
			mockClient(attachments, () => MAX_ATTACHMENT_BYTES + 1),
			'msg-1',
			'email-1'
		);
		assert.equal(count, 0);
	});

	test('does not count an attachment whose storage fails', async () => {
		const { env } = mockEnv({ failPut: true });
		const count = await storeInboundAttachments(env, mockClient(listed(2), () => 10), 'msg-1', 'email-1');
		assert.equal(count, 0);
	});

	test('counts no more than the per-message cap', async () => {
		const { env } = mockEnv();
		const count = await storeInboundAttachments(
			env,
			mockClient(listed(MAX_ATTACHMENTS_PER_EMAIL + 3), () => 10),
			'msg-1',
			'email-1'
		);
		assert.equal(count, MAX_ATTACHMENTS_PER_EMAIL);
	});

	test('returns zero when the attachment listing fails', async () => {
		const { env } = mockEnv();
		const client = {
			async listReceivedAttachments() {
				throw new Error('Resend down');
			}
		} as unknown as ResendClient;
		assert.equal(await storeInboundAttachments(env, client, 'msg-1', 'email-1'), 0);
	});
});
