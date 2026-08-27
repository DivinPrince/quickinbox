import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserByApiToken, previewFor, readBearerToken } from './api-tokens';

describe('API token preview', () => {
	test('skips the shared prefix so keys are distinguishable', () => {
		assert.equal(previewFor('qi_live_abcdEFGHxxxxxxxxwXYZ'), 'abcd…wXYZ');
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
		const token = 'qi_live_abcdefghijklmnopqrstuvwxyz012345';
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
		assert.equal(await getUserByApiToken(unusedDb, 'not-a-quickinbox-token'), null);
		assert.equal(await getUserByApiToken(unusedDb, 'qi_live_'), null);
		assert.equal(await getUserByApiToken(unusedDb, `qi_live_${'x'.repeat(300)}`), null);
		assert.equal(await getUserByApiToken(unusedDb, 'qm_live_'), null);
		assert.equal(await getUserByApiToken(unusedDb, `qm_live_${'x'.repeat(300)}`), null);
	});

	test('getUserByApiToken hashes legacy qm_live_ keys instead of rejecting them', async () => {
		let prepared = 0;
		const db = {
			prepare() {
				prepared += 1;
				throw new Error('hashed');
			}
		} as unknown as D1Database;
		await assert.rejects(
			() => getUserByApiToken(db, 'qm_live_abcdefghijklmnopqrstuvwxyz012345'),
			/hashed/
		);
		assert.equal(prepared, 1);
	});
});
