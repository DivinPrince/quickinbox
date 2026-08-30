import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseMailDomains } from './email-provider';

describe('parseMailDomains', () => {
	test('splits comma-separated domains and lowercases them', () => {
		assert.deepEqual(parseMailDomains('Mail.Yours.com, YourDomain.com'), [
			'mail.yours.com',
			'yourdomain.com'
		]);
	});

	test('ignores the dashboard placeholder so Resend deploys can leave example.com', () => {
		assert.deepEqual(parseMailDomains('example.com'), []);
		assert.deepEqual(parseMailDomains('example.com, mail.example.com'), ['mail.example.com']);
	});

	test('returns an empty list for blank values', () => {
		assert.deepEqual(parseMailDomains(''), []);
		assert.deepEqual(parseMailDomains('   '), []);
		assert.deepEqual(parseMailDomains(null), []);
	});
});
