import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	formatEmailAddress,
	parseEmailIdentities,
	parseEmailIdentity
} from './email-address';

describe('email address presentation', () => {
	test('preserves an RFC display name separately from its address', () => {
		assert.deepEqual(parseEmailIdentity('Jane Smith <Jane@example.com>'), {
			name: 'Jane Smith',
			address: 'jane@example.com'
		});
	});

	test('uses no invented name for an address-only sender', () => {
		assert.deepEqual(parseEmailIdentity('hello.there@example.com'), {
			name: null,
			address: 'hello.there@example.com'
		});
	});

	test('parses quoted names containing commas in recipient lists', () => {
		assert.deepEqual(parseEmailIdentities('"Smith, Jane" <jane@example.com>, sam@example.com'), [
			{ name: 'Smith, Jane', address: 'jane@example.com' },
			{ name: null, address: 'sam@example.com' }
		]);
	});

	test('parses a quoted name ending in a literal backslash before another recipient', () => {
		assert.deepEqual(
			parseEmailIdentities(String.raw`"Trailing\\" <first@example.com>, second@example.com`),
			[
				{ name: 'Trailing\\', address: 'first@example.com' },
				{ name: null, address: 'second@example.com' }
			]
		);
	});

	test('formats names without losing punctuation', () => {
		assert.equal(
			formatEmailAddress('Smith, Jane', 'jane@example.com'),
			'"Smith, Jane" <jane@example.com>'
		);
	});
});
