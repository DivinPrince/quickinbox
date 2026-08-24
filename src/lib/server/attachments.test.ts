import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { base64ByteLength, base64ToBytes, bytesToBase64 } from './attachments';

describe('attachment encoding', () => {
	test('bytes survive the trip to base64 and back', () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66, 67]);
		assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
	});

	test('a file larger than one chunk is not corrupted or truncated', () => {
		// 0x8000 is the chunk size, so this crosses the boundary several times.
		const bytes = new Uint8Array(0x8000 * 3 + 17);
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

		const round = base64ToBytes(bytesToBase64(bytes));
		assert.equal(round.length, bytes.length);
		assert.deepEqual(round, bytes);
	});

	test('an empty part encodes to an empty string', () => {
		assert.equal(bytesToBase64(new Uint8Array(0)), '');
	});

	test('the reported size matches the bytes encoded, whatever the padding', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 6, 100, 1023]) {
			const bytes = new Uint8Array(length).fill(7);
			assert.equal(base64ByteLength(bytesToBase64(bytes)), length);
		}
	});
});
