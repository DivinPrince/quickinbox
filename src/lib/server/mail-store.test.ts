import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildThreadParticipants } from './thread-participants';

describe('thread participants', () => {
	test('supplies a real inbound display name', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'inbound',
					from_addr: 'jane@example.com',
					from_name: 'Jane Smith',
					to_addr: 'me@example.com'
				}
			]),
			[{ label: 'Jane Smith', address: 'jane@example.com', self: false }]
		);
	});

	test('supplies recipients for sent-only and draft threads', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'Me <me@example.com>',
					from_name: 'Me',
					to_addr: 'Jane Smith <jane@example.com>, sam@example.com'
				}
			]),
			[
				{ label: 'me', address: 'me@example.com', self: true },
				{ label: 'Jane Smith', address: 'jane@example.com', self: false },
				{ label: 'sam@example.com', address: 'sam@example.com', self: false }
			]
		);
	});

	test('enriches an address-only participant when a later message supplies a name', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'me@example.com',
					from_name: 'Me',
					to_addr: 'jane@example.com'
				},
				{
					direction: 'inbound',
					from_addr: 'jane@example.com',
					from_name: 'Jane Smith',
					to_addr: 'me@example.com'
				}
			]),
			[
				{ label: 'me', address: 'me@example.com', self: true },
				{ label: 'Jane Smith', address: 'jane@example.com', self: false }
			]
		);
	});

	test('collapses multiple sending identities into one self participant', () => {
		assert.deepEqual(
			buildThreadParticipants([
				{
					direction: 'outbound',
					from_addr: 'first@example.com',
					from_name: 'First Mailbox',
					to_addr: 'jane@example.com'
				},
				{
					direction: 'outbound',
					from_addr: 'second@example.com',
					from_name: 'Second Mailbox',
					to_addr: 'jane@example.com'
				}
			]),
			[
				{ label: 'me', address: 'first@example.com', self: true },
				{ label: 'jane@example.com', address: 'jane@example.com', self: false }
			]
		);
	});
});
