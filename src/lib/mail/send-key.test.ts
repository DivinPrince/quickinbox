import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { needsNewSendKey } from './send-key';

describe('needsNewSendKey', () => {
	test('is true when retrying under the same key can only fail again', () => {
		assert.equal(needsNewSendKey('send_outcome_unknown'), true);
		assert.equal(needsNewSendKey('idempotency_conflict'), true);
	});

	test('is false when the key still works or the message is out', () => {
		for (const code of ['send_in_progress', 'already_sent', 'daily_send_limit', undefined]) {
			assert.equal(needsNewSendKey(code), false);
		}
	});
});
