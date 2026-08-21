import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { loadConfig, saveConfig } from './config.ts';

const ENV_KEYS = [
	'QUICKMAIL_CONFIG',
	'QUICKMAIL_URL',
	'QUICKMAIL_TOKEN',
	'QUICKMAIL_CF_ACCESS_CLIENT_ID',
	'QUICKMAIL_CF_ACCESS_CLIENT_SECRET'
] as const;
const originalEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const temporaryDirectories: string[] = [];

async function temporaryConfig(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'quickmail-config-test-'));
	temporaryDirectories.push(directory);
	const path = join(directory, 'config.json');
	process.env.QUICKMAIL_CONFIG = path;
	return path;
}

function restoreEnvironment(): void {
	for (const key of ENV_KEYS) {
		const value = originalEnvironment.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

afterEach(async () => {
	restoreEnvironment();
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('Cloudflare Access CLI configuration', () => {
	test('saves and loads a complete credential pair with mode 0600', async () => {
		const path = await temporaryConfig();
		await saveConfig({
			url: 'https://mail.example.com',
			token: 'qm_live_test',
			cfAccessClientId: 'saved-id.access',
			cfAccessClientSecret: 'saved-secret'
		});

		assert.equal((await stat(path)).mode & 0o777, 0o600);
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
			url: 'https://mail.example.com',
			token: 'qm_live_test',
			cfAccessClientId: 'saved-id.access',
			cfAccessClientSecret: 'saved-secret'
		});
		assert.deepEqual(await loadConfig(), {
			url: 'https://mail.example.com',
			token: 'qm_live_test',
			cfAccessClientId: 'saved-id.access',
			cfAccessClientSecret: 'saved-secret'
		});
	});

	test('uses a complete environment pair instead of saved Access credentials', async () => {
		const path = await temporaryConfig();
		await writeFile(
			path,
			JSON.stringify({
				url: 'https://saved.example.com',
				token: 'saved-token',
				cfAccessClientId: 'saved-id.access',
				cfAccessClientSecret: 'saved-secret'
			})
		);
		await chmod(path, 0o600);
		process.env.QUICKMAIL_CF_ACCESS_CLIENT_ID = 'env-id.access';
		process.env.QUICKMAIL_CF_ACCESS_CLIENT_SECRET = 'env-secret';

		assert.deepEqual(await loadConfig(), {
			url: 'https://saved.example.com',
			token: 'saved-token',
			cfAccessClientId: 'env-id.access',
			cfAccessClientSecret: 'env-secret'
		});
	});

	test('does not inherit saved Access credentials when URL and token come from the environment', async () => {
		const path = await temporaryConfig();
		await writeFile(
			path,
			JSON.stringify({
				url: 'https://saved.example.com',
				token: 'qm_live_saved',
				cfAccessClientId: 'saved-id.access',
				cfAccessClientSecret: 'saved-secret'
			})
		);
		process.env.QUICKMAIL_URL = 'https://environment.example.com';
		process.env.QUICKMAIL_TOKEN = 'qm_live_environment';

		assert.deepEqual(await loadConfig(), {
			url: 'https://environment.example.com',
			token: 'qm_live_environment'
		});
	});

	test('rejects a partial environment URL/token pair instead of mixing credential sources', async () => {
		const path = await temporaryConfig();
		await writeFile(
			path,
			JSON.stringify({
				url: 'https://saved.example.com',
				token: 'qm_live_saved'
			})
		);
		process.env.QUICKMAIL_URL = 'https://environment.example.com';

		await assert.rejects(
			loadConfig(),
			/QUICKMAIL_URL and QUICKMAIL_TOKEN must be configured together/
		);
	});

	test('rejects a half-configured saved pair', async () => {
		const path = await temporaryConfig();
		await writeFile(
			path,
			JSON.stringify({
				url: 'https://mail.example.com',
				token: 'qm_live_test',
				cfAccessClientId: 'saved-id.access'
			})
		);

		await assert.rejects(loadConfig(), /Cloudflare Access client ID and secret must be configured together/);
	});

	test('rejects explicitly empty Access values instead of treating them as disabled', async () => {
		await temporaryConfig();
		for (const access of [
			{ cfAccessClientId: '', cfAccessClientSecret: 'saved-secret' },
			{ cfAccessClientId: 'saved-id.access', cfAccessClientSecret: '' },
			{ cfAccessClientId: '', cfAccessClientSecret: '' }
		]) {
			await assert.rejects(
				saveConfig({
					url: 'https://mail.example.com',
					token: 'qm_live_test',
					...access
				}),
				/Cloudflare Access client ID and secret must be configured together/
			);
		}
	});

	test('rejects a half-configured environment pair instead of mixing it with saved credentials', async () => {
		const path = await temporaryConfig();
		await writeFile(
			path,
			JSON.stringify({
				url: 'https://mail.example.com',
				token: 'qm_live_test',
				cfAccessClientId: 'saved-id.access',
				cfAccessClientSecret: 'saved-secret'
			})
		);
		process.env.QUICKMAIL_CF_ACCESS_CLIENT_ID = 'env-id.access';
		delete process.env.QUICKMAIL_CF_ACCESS_CLIENT_SECRET;

		await assert.rejects(loadConfig(), /Cloudflare Access client ID and secret must be configured together/);
	});
});
