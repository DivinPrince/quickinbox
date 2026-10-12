import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { codeForSendError, ProviderError, statusForProviderError } from './context';
import { ReplyGuardError } from './outbox';
import { SendAttemptError } from './send-attempts';
import { SendPolicyError } from './send-policy';

describe('codeForSendError', () => {
	test('names the reason a send was refused, as MCP does', () => {
		const cases = [
			new SendAttemptError('send_in_progress', 'busy'),
			new SendAttemptError('send_outcome_unknown', 'unknown'),
			new SendPolicyError('daily_send_limit', 429, 'limit'),
			new ReplyGuardError('recipient_changed', 'changed')
		];
		for (const error of cases) {
			assert.equal(codeForSendError(error), error.code);
			assert.equal(statusForProviderError(error), error.status);
		}
	});

	test('has no code for other failures', () => {
		assert.equal(codeForSendError(new ProviderError(422, 'validation_error', 'nope')), undefined);
		assert.equal(codeForSendError(new Error('Message body is required')), undefined);
	});
});
