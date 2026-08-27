import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserByApiToken, previewFor, readBearerToken } from './api-tokens';

describe('API token preview', () => {
	test('skips the shared prefix so keys are distinguishable', () => {
		assert.equal(previewFor('qm_live_abcdEFGHxxxxxxxxwXYZ'), 'abcd…wXYZ');
	});

	test('still works if the prefix is missing', () => {
		assert.equal(previewFor('abcdEFGHxxxxxxxxwXYZ'), 'abcd…wXYZ');
	});
});

describe('API token parsing', () => {
	const unusedDb = {
		prepare() {
			throw new Error('must not hash or query an implausible token');
		}
	} as unknown as D1Database;

	test('readBearerToken extracts a Bearer value and rejects oversized tokens', () => {
		const token = 'qm_live_abcdefghijklmnopqrstuvwxyz012345';
		const request = new Request('https://mail.example.com', {
			headers: { authorization: `Bearer ${token}` }
		});
		assert.equal(readBearerToken(request), token);

		const oversized = new Request('https://mail.example.com', {
			headers: { authorization: `Bearer ${'x'.repeat(300)}` }
		});
		assert.equal(readBearerToken(oversized), null);
		assert.equal(readBearerToken(new Request('https://mail.example.com')), null);
	});

	test('getUserByApiToken rejects missing prefix and oversized tokens before hashing', async () => {
		assert.equal(await getUserByApiToken(unusedDb, 'not-a-quickmail-token'), null);
		assert.equal(await getUserByApiToken(unusedDb, 'qm_live_'), null);
		assert.equal(await getUserByApiToken(unusedDb, `qm_live_${'x'.repeat(300)}`), null);
	});
});
