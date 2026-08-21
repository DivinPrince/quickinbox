/**
 * Cloudflare account selection for setup and deploy.
 *
 * Wrangler reads CLOUDFLARE_ACCOUNT_ID from the process environment (not from
 * Worker `.dev.vars`). Setup writes that id to `.env`; this module loads it
 * back so later wrangler commands see it. A personal account id must never be
 * committed in wrangler.jsonc.
 */
export const CLOUDFLARE_AUTH_KEYS = [
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
	'CLOUDFLARE_API_KEY',
	'CLOUDFLARE_EMAIL'
];

export function isCloudflareAccountId(value) {
	return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value.trim());
}

export function parseDotEnv(text) {
	const out = {};
	if (!text) return out;

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const stripped = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
		const eq = stripped.indexOf('=');
		if (eq <= 0) continue;
		const key = stripped.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = stripped.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else {
			const comment = value.indexOf(' #');
			if (comment !== -1) value = value.slice(0, comment).trim();
		}
		out[key] = value;
	}
	return out;
}

export function cloudflareAuthFromDotEnv(text) {
	const parsed = parseDotEnv(text);
	const out = {};
	for (const key of CLOUDFLARE_AUTH_KEYS) {
		const value = parsed[key];
		if (value) out[key] = value;
	}
	return out;
}

/**
 * Copy Cloudflare auth vars from dotenv text into `env` without overwriting
 * values already set (CI / Workers Builds / the user's shell win).
 */
export function applyCloudflareAuthEnv(env, texts) {
	const merged = {};
	for (const text of texts) {
		Object.assign(merged, cloudflareAuthFromDotEnv(text));
	}
	for (const [key, value] of Object.entries(merged)) {
		if (!env[key] && value) env[key] = value;
	}
	return env;
}

export function setAccountIdInWrangler(source, accountId) {
	if (!isCloudflareAccountId(accountId)) {
		throw new Error('Invalid Cloudflare account id (expected 32 hex characters).');
	}
	const id = accountId.trim().toLowerCase();
	if (/^\s*"account_id"\s*:/m.test(source)) {
		return source.replace(/^(\s*"account_id"\s*:\s*")[^"]*(")/m, `$1${id}$2`);
	}
	if (/^\s*\/\/\s*"account_id"\s*:/m.test(source)) {
		return source.replace(/^\s*\/\/\s*"account_id"\s*:\s*"[^"]*"\s*,?\s*$/m, `\t"account_id": "${id}",`);
	}
	if (/"workers_dev"\s*:/.test(source)) {
		return source.replace(/("workers_dev"\s*:\s*(?:true|false),?\n)/, `$1\n\t"account_id": "${id}",\n`);
	}
	return `\t"account_id": "${id}",\n${source}`;
}
