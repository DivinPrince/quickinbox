import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CliConfig = {
	url: string;
	token: string;
};

/** One saved login. `name` is what `--account` and the MCP `account` argument refer to. */
export type Account = CliConfig & {
	name: string;
	/** True when the account came from QUICKINBOX_URL / QUICKINBOX_TOKEN rather than the config file. */
	fromEnv?: boolean;
};

export type AccountSet = {
	accounts: Account[];
	/** Name of the account used when none is given. Undefined when no accounts exist. */
	defaultName?: string;
};

type StoredAccount = { url: string; token: string };

type StoredConfig = {
	default?: string;
	accounts: Record<string, StoredAccount>;
};

const NOT_LOGGED_IN =
	'Not logged in. Run `quickinbox login --url <instance> --token <key>` or set QUICKINBOX_URL and QUICKINBOX_TOKEN.';

/** Prefer the new name, then the pre-rename `QUICKMAIL_*` variables. */
export function envFlag(...names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name];
		if (value) return value;
	}
	return undefined;
}

function writeConfigPath(): string {
	const override = envFlag('QUICKINBOX_CONFIG', 'QUICKMAIL_CONFIG');
	if (override) return override;
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	return join(base, 'quickinbox', 'config.json');
}

function readConfigPath(): string {
	const next = writeConfigPath();
	if (existsSync(next) || envFlag('QUICKINBOX_CONFIG', 'QUICKMAIL_CONFIG')) return next;
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	const legacy = join(base, 'quickmail', 'config.json');
	return existsSync(legacy) ? legacy : next;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Require http(s). HTTP is only allowed for loopback. Never echo the input. */
export function normalizeUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new Error('Quickinbox URL is invalid.');
	}

	if (parsed.username || parsed.password) {
		throw new Error('Quickinbox URL must not include credentials.');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Quickinbox URL must use http or https.');
	}

	if (!parsed.hostname) {
		throw new Error('Quickinbox URL is invalid.');
	}

	const host = parsed.hostname.toLowerCase();
	if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(host)) {
		throw new Error('HTTP is only allowed for localhost.');
	}

	return parsed.href.replace(/\/+$/, '');
}

const ACCOUNT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Account names are used as CLI flags and MCP arguments, so keep them short and shell-safe. */
export function normalizeAccountName(name: string): string {
	const trimmed = name.trim();
	if (!ACCOUNT_NAME.test(trimmed)) {
		throw new Error(
			'Account name must be 1-64 characters: letters, digits, ".", "_" or "-", starting with a letter or digit.'
		);
	}
	return trimmed.toLowerCase();
}

/** Default account name for a URL: its hostname (plus port for local dev). */
export function accountNameForUrl(url: string): string {
	const parsed = new URL(normalizeUrl(url));
	return parsed.port ? `${parsed.hostname}-${parsed.port}` : parsed.hostname;
}

function sameUrl(a: string, b: string): boolean {
	try {
		return normalizeUrl(a) === normalizeUrl(b);
	} catch {
		return false;
	}
}

function isStoredAccount(value: unknown): value is StoredAccount {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as StoredAccount).url === 'string' &&
		typeof (value as StoredAccount).token === 'string' &&
		(value as StoredAccount).url.length > 0 &&
		(value as StoredAccount).token.length > 0
	);
}

/**
 * Read the config file. Accepts both the multi-account shape and the original
 * single `{ url, token }` file, which is exposed as one account named after its host.
 */
async function loadStored(): Promise<StoredConfig> {
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(readConfigPath(), 'utf8'));
	} catch {
		return { accounts: {} };
	}
	if (typeof raw !== 'object' || raw === null) return { accounts: {} };

	const record = raw as Record<string, unknown>;
	if (typeof record.accounts === 'object' && record.accounts !== null) {
		const accounts: Record<string, StoredAccount> = {};
		for (const [name, value] of Object.entries(record.accounts as Record<string, unknown>)) {
			if (!isStoredAccount(value) || !ACCOUNT_NAME.test(name)) continue;
			accounts[name.toLowerCase()] = { url: value.url, token: value.token };
		}
		const fallback = typeof record.default === 'string' ? record.default.toLowerCase() : undefined;
		return { default: fallback && accounts[fallback] ? fallback : undefined, accounts };
	}

	if (isStoredAccount(record)) {
		let name: string;
		try {
			name = accountNameForUrl(record.url);
		} catch {
			return { accounts: {} };
		}
		return { default: name, accounts: { [name]: { url: record.url, token: record.token } } };
	}

	return { accounts: {} };
}

async function writeStored(config: StoredConfig): Promise<string> {
	const path = writeConfigPath();
	await mkdir(dirname(path), { recursive: true });
	const payload: StoredConfig = { accounts: config.accounts };
	if (config.default && config.accounts[config.default]) payload.default = config.default;
	await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
	return path;
}

function envAccount(): Account | undefined {
	const url = envFlag('QUICKINBOX_URL', 'QUICKMAIL_URL');
	const token = envFlag('QUICKINBOX_TOKEN', 'QUICKMAIL_TOKEN');
	if (!url || !token) return undefined;
	const normalized = normalizeUrl(url);
	return { name: accountNameForUrl(normalized), url: normalized, token, fromEnv: true };
}

/**
 * Every account the CLI can use, plus which one is the default.
 *
 * Precedence for the default: QUICKINBOX_URL/TOKEN (an env account always wins, as before),
 * then QUICKINBOX_ACCOUNT, then the `default` saved by `login --default` / `accounts use`,
 * then the first saved account.
 */
export async function loadAccounts(): Promise<AccountSet> {
	const stored = await loadStored();
	const accounts: Account[] = [];
	for (const [name, value] of Object.entries(stored.accounts)) {
		try {
			accounts.push({ name, url: normalizeUrl(value.url), token: value.token });
		} catch {
			// Skip entries whose URL no longer passes validation rather than failing every command.
		}
	}

	const fromEnv = envAccount();
	if (fromEnv) {
		const index = accounts.findIndex((account) => account.name === fromEnv.name);
		if (index >= 0) accounts.splice(index, 1);
		accounts.unshift(fromEnv);
	}

	if (accounts.length === 0) return { accounts };

	let defaultName: string | undefined;
	if (fromEnv) {
		defaultName = fromEnv.name;
	} else {
		const requested = envFlag('QUICKINBOX_ACCOUNT', 'QUICKMAIL_ACCOUNT')?.toLowerCase();
		if (requested && accounts.some((account) => account.name === requested)) {
			defaultName = requested;
		} else if (stored.default && accounts.some((account) => account.name === stored.default)) {
			defaultName = stored.default;
		} else {
			defaultName = accounts[0].name;
		}
	}

	return { accounts, defaultName };
}

/** Look up one account by name, or the default when no name is given. */
export async function resolveAccount(name?: string): Promise<Account> {
	const { accounts, defaultName } = await loadAccounts();
	if (accounts.length === 0) throw new Error(NOT_LOGGED_IN);

	if (name) {
		const wanted = name.trim().toLowerCase();
		const match =
			accounts.find((account) => account.name === wanted) ??
			accounts.find((account) => sameUrl(account.url, wanted));
		if (!match) {
			throw new Error(
				`Unknown account "${name.trim()}". Known accounts: ${accounts.map((account) => account.name).join(', ')}.`
			);
		}
		return match;
	}

	const fallback = accounts.find((account) => account.name === defaultName) ?? accounts[0];
	return fallback;
}

/** The default account as a plain `{ url, token }`. Kept for scripts that imported the old API. */
export async function loadConfig(): Promise<CliConfig> {
	const account = await resolveAccount();
	return { url: account.url, token: account.token };
}

export type SaveAccountInput = CliConfig & {
	/** Defaults to the existing account with the same URL, else the URL's hostname. */
	name?: string;
	/** Make this the default account. The first saved account is always the default. */
	makeDefault?: boolean;
};

/** Add or update an account. Returns where it was written and the name it was saved under. */
export async function saveAccount(input: SaveAccountInput): Promise<{ path: string; name: string }> {
	const url = normalizeUrl(input.url);
	const stored = await loadStored();

	let name: string;
	if (input.name) {
		name = normalizeAccountName(input.name);
	} else {
		const existing = Object.entries(stored.accounts).find(([, value]) => sameUrl(value.url, url));
		name = existing ? existing[0] : accountNameForUrl(url);
	}

	stored.accounts[name] = { url, token: input.token };
	if (input.makeDefault || !stored.default || !stored.accounts[stored.default]) {
		stored.default = name;
	}

	const path = await writeStored(stored);
	return { path, name };
}

/** Back-compat wrapper: saves as the default account. */
export async function saveConfig(config: CliConfig): Promise<string> {
	const { path } = await saveAccount({ ...config, makeDefault: true });
	return path;
}

export async function setDefaultAccount(name: string): Promise<string> {
	const stored = await loadStored();
	const wanted = name.trim().toLowerCase();
	if (!stored.accounts[wanted]) {
		const known = Object.keys(stored.accounts);
		throw new Error(
			known.length === 0
				? NOT_LOGGED_IN
				: `Unknown account "${name.trim()}". Known accounts: ${known.join(', ')}.`
		);
	}
	stored.default = wanted;
	await writeStored(stored);
	return wanted;
}

async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

/** Remove one saved account. Returns the names that remain. */
export async function removeAccount(name: string): Promise<string[]> {
	const stored = await loadStored();
	const wanted = name.trim().toLowerCase();
	if (!stored.accounts[wanted]) {
		const known = Object.keys(stored.accounts);
		throw new Error(
			known.length === 0
				? NOT_LOGGED_IN
				: `Unknown account "${name.trim()}". Known accounts: ${known.join(', ')}.`
		);
	}
	delete stored.accounts[wanted];
	const remaining = Object.keys(stored.accounts);
	if (remaining.length === 0) {
		await clearConfig();
		return [];
	}
	if (stored.default === wanted) stored.default = remaining[0];
	await writeStored(stored);
	return remaining;
}

export async function clearConfig(): Promise<void> {
	const next = writeConfigPath();
	await unlinkIfPresent(next);
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	const legacy = join(base, 'quickmail', 'config.json');
	if (legacy !== next) await unlinkIfPresent(legacy);
}

export { writeConfigPath as configPath };
