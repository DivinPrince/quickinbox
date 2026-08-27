import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CliConfig = {
	url: string;
	token: string;
};

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

export async function loadConfig(): Promise<CliConfig> {
	const envUrl = envFlag('QUICKINBOX_URL', 'QUICKMAIL_URL');
	const envToken = envFlag('QUICKINBOX_TOKEN', 'QUICKMAIL_TOKEN');
	if (envUrl && envToken) {
		return { url: normalizeUrl(envUrl), token: envToken };
	}

	let raw: Partial<CliConfig>;
	try {
		raw = JSON.parse(await readFile(readConfigPath(), 'utf8')) as Partial<CliConfig>;
	} catch {
		throw new Error(
			'Not logged in. Run `quickinbox login --url <instance> --token <key>` or set QUICKINBOX_URL and QUICKINBOX_TOKEN.'
		);
	}

	const url = envUrl ?? raw.url;
	const token = envToken ?? raw.token;
	if (!url || !token) {
		throw new Error(
			'Not logged in. Run `quickinbox login --url <instance> --token <key>` or set QUICKINBOX_URL and QUICKINBOX_TOKEN.'
		);
	}
	return { url: normalizeUrl(url), token };
}

export async function saveConfig(config: CliConfig): Promise<string> {
	const path = writeConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ url: normalizeUrl(config.url), token: config.token }, null, 2)}\n`,
		{ mode: 0o600 }
	);
	await chmod(path, 0o600);
	return path;
}

async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

export async function clearConfig(): Promise<void> {
	const next = writeConfigPath();
	await unlinkIfPresent(next);
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	const legacy = join(base, 'quickmail', 'config.json');
	if (legacy !== next) await unlinkIfPresent(legacy);
}

export { writeConfigPath as configPath };
