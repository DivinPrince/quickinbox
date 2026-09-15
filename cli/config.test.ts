import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
	accountNameForUrl,
	loadAccounts,
	loadConfig,
	normalizeAccountName,
	removeAccount,
	resolveAccount,
	saveAccount,
	saveConfig,
	setDefaultAccount
} from './config.ts';

const ENV_KEYS = [
	'QUICKINBOX_CONFIG',
	'QUICKMAIL_CONFIG',
	'QUICKINBOX_URL',
	'QUICKMAIL_URL',
	'QUICKINBOX_TOKEN',
	'QUICKMAIL_TOKEN',
	'QUICKINBOX_ACCOUNT',
	'QUICKMAIL_ACCOUNT',
	'XDG_CONFIG_HOME'
];

let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
	saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) delete process.env[key];
	dir = await mkdtemp(join(tmpdir(), 'quickinbox-config-'));
	process.env.XDG_CONFIG_HOME = dir;
});

afterEach(async () => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	await rm(dir, { recursive: true, force: true });
});

async function readStored(): Promise<unknown> {
	return JSON.parse(await readFile(join(dir, 'quickinbox', 'config.json'), 'utf8'));
}

describe('account names', () => {
	test('derive from the host, adding the port for local dev', () => {
		assert.equal(accountNameForUrl('https://mail.alter.rw/'), 'mail.alter.rw');
		assert.equal(accountNameForUrl('http://localhost:5173'), 'localhost-5173');
		assert.equal(accountNameForUrl('http://[::1]:5173'), '1-5173');
		assert.equal(accountNameForUrl(`https://${'a'.repeat(80)}.example/`), 'a'.repeat(64));
	});

	test('reject shell-unfriendly names', () => {
		assert.equal(normalizeAccountName(' Work '), 'work');
		assert.throws(() => normalizeAccountName('has space'));
		assert.throws(() => normalizeAccountName('-leading'));
		assert.throws(() => normalizeAccountName(''));
	});
});

describe('loadAccounts', () => {
	test('is empty when nothing is saved', async () => {
		const set = await loadAccounts();
		assert.deepEqual(set.accounts, []);
		assert.equal(set.defaultName, undefined);
		await assert.rejects(resolveAccount(), /Not logged in/);
	});

	test('reads the legacy single { url, token } file as one account named after its host', async () => {
		await mkdir(join(dir, 'quickinbox'), { recursive: true });
		await writeFile(
			join(dir, 'quickinbox', 'config.json'),
			JSON.stringify({ url: 'https://mail.example.com/', token: 'qi_live_a' })
		);
		const set = await loadAccounts();
		assert.equal(set.accounts.length, 1);
		assert.equal(set.accounts[0].name, 'mail.example.com');
		assert.equal(set.accounts[0].url, 'https://mail.example.com');
		assert.equal(set.defaultName, 'mail.example.com');
		assert.deepEqual(await loadConfig(), { url: 'https://mail.example.com', token: 'qi_live_a' });
	});

	test('reads the legacy quickmail/ directory when the new one is absent', async () => {
		await mkdir(join(dir, 'quickmail'), { recursive: true });
		await writeFile(
			join(dir, 'quickmail', 'config.json'),
			JSON.stringify({ url: 'https://old.example.com', token: 'qm_live_a' })
		);
		const account = await resolveAccount();
		assert.equal(account.name, 'old.example.com');
	});

	test('ignores malformed entries instead of failing', async () => {
		await mkdir(join(dir, 'quickinbox'), { recursive: true });
		await writeFile(
			join(dir, 'quickinbox', 'config.json'),
			JSON.stringify({
				default: 'missing',
				accounts: {
					good: { url: 'https://a.example.com', token: 't' },
					'bad name!': { url: 'https://b.example.com', token: 't' },
					notoken: { url: 'https://c.example.com' },
					badurl: { url: 'ftp://d.example.com', token: 't' }
				}
			})
		);
		const set = await loadAccounts();
		assert.deepEqual(
			set.accounts.map((account) => account.name),
			['good']
		);
		assert.equal(set.defaultName, 'good');
	});
});

describe('saveAccount', () => {
	test('first login becomes the default; later ones do not unless asked', async () => {
		const first = await saveAccount({ url: 'https://one.example.com', token: 'a' });
		assert.equal(first.name, 'one.example.com');
		const second = await saveAccount({ url: 'https://two.example.com', token: 'b', name: 'Work' });
		assert.equal(second.name, 'work');

		let set = await loadAccounts();
		assert.deepEqual(set.accounts.map((account) => account.name).sort(), ['one.example.com', 'work']);
		assert.equal(set.defaultName, 'one.example.com');

		await saveAccount({ url: 'https://three.example.com', token: 'c', name: 'side', makeDefault: true });
		set = await loadAccounts();
		assert.equal(set.defaultName, 'side');
	});

	test('re-login to the same URL without a name updates that account in place', async () => {
		await saveAccount({ url: 'https://one.example.com', token: 'old', name: 'main' });
		const again = await saveAccount({ url: 'https://one.example.com/', token: 'new' });
		assert.equal(again.name, 'main');
		const account = await resolveAccount('main');
		assert.equal(account.token, 'new');
		assert.equal((await loadAccounts()).accounts.length, 1);
	});

	test('migrates the legacy file shape on write and keeps 0600 permissions', async () => {
		await mkdir(join(dir, 'quickinbox'), { recursive: true });
		await writeFile(
			join(dir, 'quickinbox', 'config.json'),
			JSON.stringify({ url: 'https://mail.example.com', token: 'qi_live_a' })
		);
		await saveAccount({ url: 'https://other.example.com', token: 'b' });
		const stored = (await readStored()) as { default: string; accounts: Record<string, unknown> };
		assert.equal(stored.default, 'mail.example.com');
		assert.deepEqual(Object.keys(stored.accounts).sort(), ['mail.example.com', 'other.example.com']);
	});

	test('saveConfig keeps working for old callers and makes that account the default', async () => {
		await saveAccount({ url: 'https://one.example.com', token: 'a' });
		await saveConfig({ url: 'https://two.example.com', token: 'b' });
		assert.deepEqual(await loadConfig(), { url: 'https://two.example.com', token: 'b' });
	});
});

describe('resolveAccount', () => {
	beforeEach(async () => {
		await saveAccount({ url: 'https://one.example.com', token: 'a', name: 'one' });
		await saveAccount({ url: 'https://two.example.com', token: 'b', name: 'two' });
	});

	test('by name, case-insensitively, or by URL', async () => {
		assert.equal((await resolveAccount('TWO')).token, 'b');
		assert.equal((await resolveAccount('https://two.example.com')).token, 'b');
	});

	test('lists known accounts on a miss', async () => {
		await assert.rejects(resolveAccount('nope'), /Unknown account "nope".*one, two/);
	});

	test('honours QUICKINBOX_ACCOUNT and the saved default', async () => {
		assert.equal((await resolveAccount()).name, 'one');
		await setDefaultAccount('two');
		assert.equal((await resolveAccount()).name, 'two');
		process.env.QUICKINBOX_ACCOUNT = 'one';
		assert.equal((await resolveAccount()).name, 'one');
		process.env.QUICKINBOX_ACCOUNT = 'unknown';
		assert.equal((await resolveAccount()).name, 'two');
	});

	test('QUICKINBOX_URL / QUICKINBOX_TOKEN add an env account that becomes the default', async () => {
		process.env.QUICKINBOX_URL = 'https://env.example.com';
		process.env.QUICKINBOX_TOKEN = 'env-token';
		const set = await loadAccounts();
		assert.equal(set.defaultName, 'env.example.com');
		assert.equal(set.accounts.length, 3);
		assert.equal(set.accounts[0].fromEnv, true);
		assert.equal((await resolveAccount()).token, 'env-token');
		assert.equal((await resolveAccount('two')).token, 'b');
	});

	test('an env account shadows a saved account with the same name', async () => {
		process.env.QUICKMAIL_URL = 'https://one.example.com';
		process.env.QUICKMAIL_TOKEN = 'env-token';
		await saveAccount({ url: 'https://one.example.com', token: 'saved', name: 'one.example.com' });
		const set = await loadAccounts();
		const shadowed = set.accounts.filter((account) => account.name === 'one.example.com');
		assert.equal(shadowed.length, 1);
		assert.equal(shadowed[0].token, 'env-token');
	});
});

describe('removeAccount / setDefaultAccount', () => {
	test('moves the default to the next account and clears the file when none remain', async () => {
		await saveAccount({ url: 'https://one.example.com', token: 'a', name: 'one' });
		await saveAccount({ url: 'https://two.example.com', token: 'b', name: 'two' });
		assert.deepEqual(await removeAccount('one'), ['two']);
		assert.equal((await loadAccounts()).defaultName, 'two');
		assert.deepEqual(await removeAccount('two'), []);
		await assert.rejects(readStored());
		await assert.rejects(removeAccount('two'), /Not logged in/);
	});

	test('rejects unknown names', async () => {
		await saveAccount({ url: 'https://one.example.com', token: 'a', name: 'one' });
		await assert.rejects(setDefaultAccount('zzz'), /Unknown account "zzz"/);
		await assert.rejects(removeAccount('zzz'), /Unknown account "zzz"/);
	});
});
