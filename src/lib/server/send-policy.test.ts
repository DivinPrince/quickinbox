import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { apiSendPolicy, claimDailySend, DEFAULT_API_DAILY_SEND_LIMIT } from './send-policy';
import { createTestDb, insertTestUser } from './test-db';

describe('apiSendPolicy', () => {
	test('sends are enabled with the default limit when nothing is configured', () => {
		assert.deepEqual(apiSendPolicy({}), {
			enabled: true,
			dailyLimit: DEFAULT_API_DAILY_SEND_LIMIT
		});
		assert.deepEqual(apiSendPolicy(undefined), {
			enabled: true,
			dailyLimit: DEFAULT_API_DAILY_SEND_LIMIT
		});
	});

	test('API_SEND_ENABLED=false turns token sending off', () => {
		assert.equal(apiSendPolicy({ API_SEND_ENABLED: 'false' }).enabled, false);
		assert.equal(apiSendPolicy({ API_SEND_ENABLED: ' FALSE ' }).enabled, false);
		assert.equal(apiSendPolicy({ API_SEND_ENABLED: 'true' }).enabled, true);
	});

	test('API_DAILY_SEND_LIMIT sets the cap, and 0 removes it', () => {
		assert.equal(apiSendPolicy({ API_DAILY_SEND_LIMIT: '25' }).dailyLimit, 25);
		assert.equal(apiSendPolicy({ API_DAILY_SEND_LIMIT: '0' }).dailyLimit, null);
	});

	test('a malformed limit keeps the default instead of lifting the cap', () => {
		assert.equal(apiSendPolicy({ API_DAILY_SEND_LIMIT: 'lots' }).dailyLimit, 100);
		assert.equal(apiSendPolicy({ API_DAILY_SEND_LIMIT: '-5' }).dailyLimit, 100);
		assert.equal(apiSendPolicy({ API_DAILY_SEND_LIMIT: '2.5' }).dailyLimit, 100);
	});
});

describe('claimDailySend', () => {
	test('allows exactly the limit, then refuses', async () => {
		const { db, sqlite } = createTestDb();
		insertTestUser(sqlite, 'user-1');

		const outcomes = [];
		for (let i = 0; i < 4; i++) outcomes.push(await claimDailySend(db, 'user-1', 3));

		assert.deepEqual(outcomes, [true, true, true, false]);
	});

	test('counts each user separately', async () => {
		const { db, sqlite } = createTestDb();
		insertTestUser(sqlite, 'user-1');
		insertTestUser(sqlite, 'user-2');

		assert.equal(await claimDailySend(db, 'user-1', 1), true);
		assert.equal(await claimDailySend(db, 'user-1', 1), false);
		assert.equal(await claimDailySend(db, 'user-2', 1), true);
	});
});
