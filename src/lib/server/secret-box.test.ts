import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configuredEncryptionKey, openSecret, sealSecret } from './secret-box';

const KEY = 'k'.repeat(32);

describe('sealSecret / openSecret', () => {
	test('round-trips a secret', async () => {
		const sealed = await sealSecret(KEY, 'sk-live-abc123', 'ai:user-1');
		assert.notEqual(sealed, 'sk-live-abc123');
		assert.ok(!sealed.includes('abc123'));
		assert.equal(await openSecret(KEY, sealed, 'ai:user-1'), 'sk-live-abc123');
	});

	test('two seals of the same secret differ', async () => {
		assert.notEqual(await sealSecret(KEY, 'same', 'ctx'), await sealSecret(KEY, 'same', 'ctx'));
	});

	test('refuses a value moved to another row', async () => {
		const sealed = await sealSecret(KEY, 'sk-live-abc123', 'ai:user-1');
		await assert.rejects(openSecret(KEY, sealed, 'ai:user-2'));
	});

	test('refuses a value sealed under another key', async () => {
		const sealed = await sealSecret(KEY, 'sk-live-abc123', 'ai:user-1');
		await assert.rejects(openSecret('x'.repeat(32), sealed, 'ai:user-1'));
	});
});

describe('configuredEncryptionKey', () => {
	test('accepts a long random value', () => {
		assert.equal(configuredEncryptionKey(` ${KEY} `), KEY);
	});

	test('treats missing, short and placeholder values as unset', () => {
		assert.equal(configuredEncryptionKey(undefined), undefined);
		assert.equal(configuredEncryptionKey('short'), undefined);
		assert.equal(configuredEncryptionKey('REPLACE_WITH_A_RANDOM_SECRET_OF_32_CHARACTERS'), undefined);
	});
});
