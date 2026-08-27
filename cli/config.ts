import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CliConfig = {
	url: string;
	token: string;
};

function configPath(): string {
	const override = process.env.QUICKMAIL_CONFIG;
	if (override) return override;
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	return join(base, 'quickmail', 'config.json');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Require http(s). HTTP is only allowed for loopback. Never echo the input. */
export function normalizeUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new Error('QuickMail URL is invalid.');
	}

	if (parsed.username || parsed.password) {
		throw new Error('QuickMail URL must not include credentials.');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('QuickMail URL must use http or https.');
	}

	if (!parsed.hostname) {
		throw new Error('QuickMail URL is invalid.');
	}

	const host = parsed.hostname.toLowerCase();
	if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(host)) {
		throw new Error('HTTP is only allowed for localhost.');
	}

	return parsed.href.replace(/\/+$/, '');
}

export async function loadConfig(): Promise<CliConfig> {
	const envUrl = process.env.QUICKMAIL_URL;
	const envToken = process.env.QUICKMAIL_TOKEN;
	if (envUrl && envToken) {
		return { url: normalizeUrl(envUrl), token: envToken };
	}

	let raw: Partial<CliConfig>;
	try {
		raw = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<CliConfig>;
	} catch {
		throw new Error(
			'Not logged in. Run `quickmail login --url <instance> --token <key>` or set QUICKMAIL_URL and QUICKMAIL_TOKEN.'
		);
	}

	const url = envUrl ?? raw.url;
	const token = envToken ?? raw.token;
	if (!url || !token) {
		throw new Error(
			'Not logged in. Run `quickmail login --url <instance> --token <key>` or set QUICKMAIL_URL and QUICKMAIL_TOKEN.'
		);
	}
	return { url: normalizeUrl(url), token };
}

export async function saveConfig(config: CliConfig): Promise<string> {
	const path = configPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ url: normalizeUrl(config.url), token: config.token }, null, 2)}\n`,
		{ mode: 0o600 }
	);
	await chmod(path, 0o600);
	return path;
}

export async function clearConfig(): Promise<void> {
	try {
		await unlink(configPath());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

export { configPath };
