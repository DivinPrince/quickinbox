#!/usr/bin/env node
/**
 * Refuse to ship the template if anything personal leaked into it.
 *
 * QuickMail is maintained alongside a private deployment, so commits get
 * cherry-picked between the two. This is the gate that stops a real API key,
 * a Cloudflare account id, or a personal hostname riding along into the repo
 * that anyone can read.
 *
 * Scans exactly the files git tracks — the set that actually ships.
 *
 * Usage: node scripts/check-template-clean.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

// Anything matching these must never appear in a tracked file.
const FORBIDDEN = [
	{ label: 'Resend API key', pattern: /re_[A-Za-z0-9_-]{20,}/ },
	{ label: 'Webhook signing secret', pattern: /whsec_[A-Za-z0-9+/=_-]{16,}/ },
	{ label: 'GitHub token', pattern: /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|gho_[A-Za-z0-9]{30,})\b/ },
	{ label: 'Cloudflare API token', pattern: /\bCLOUDFLARE_API_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/ },
	{ label: 'Private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
	{ label: 'Live Cloudflare account id', pattern: /^\s*"account_id"\s*:\s*"[0-9a-f]{32}"/m },
	{ label: 'Maintainer infrastructure name', pattern: /divinprince[.-]/i }
];

// Files whose whole job is to show what a secret looks like.
const SKIP_FILES = new Set(['scripts/check-template-clean.mjs']);
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|ico|woff2?|ttf|eot|pdf|zip|lock)$/i;

// A hit that is obviously a placeholder rather than a real credential.
const isPlaceholder = (value) =>
	/x{4,}/i.test(value) || /REPLACE_WITH|your[-_]?/i.test(value) || /example\.com/i.test(value);

const failures = [];

function fail(message) {
	failures.push(message);
}

const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter(Boolean);

if (tracked.length === 0) {
	fail('git ls-files returned nothing — is this a git repository?');
}

// 1. No secrets or personal identifiers in tracked content.
for (const file of tracked) {
	if (SKIP_FILES.has(file) || SKIP_EXTENSIONS.test(file)) continue;

	let contents;
	try {
		contents = readFileSync(new URL(file, `file://${root}`), 'utf8');
	} catch {
		continue; // unreadable or binary — nothing to scan
	}

	for (const { label, pattern } of FORBIDDEN) {
		const match = contents.match(pattern);
		if (match && !isPlaceholder(match[0])) {
			const line = contents.slice(0, match.index).split('\n').length;
			fail(`${label} in ${file}:${line} — matched ${JSON.stringify(match[0].slice(0, 40))}`);
		}
	}
}

// 2. Local secret files must never be tracked.
for (const secretFile of ['.dev.vars', '.env', '.env.local']) {
	if (tracked.includes(secretFile)) {
		fail(`${secretFile} is tracked by git — it must stay ignored`);
	}
}

// 3. wrangler.jsonc must still be a template, not a working config.
const wranglerPath = new URL('wrangler.jsonc', `file://${root}`);
if (!existsSync(wranglerPath)) {
	fail('wrangler.jsonc is missing');
} else {
	const wrangler = readFileSync(wranglerPath, 'utf8');
	if (!wrangler.includes('REPLACE_WITH_YOUR_D1_DATABASE_ID')) {
		fail(
			'wrangler.jsonc no longer has the database_id placeholder — a real D1 id was committed'
		);
	}
	const route = wrangler.match(/^\s*"pattern"\s*:\s*"([^"]+)"/m);
	if (route && !route[1].includes('example.com')) {
		fail(`wrangler.jsonc has a live route pattern: ${route[1]} — it should stay commented out`);
	}
}

// 4. The licence has to ship with the code.
for (const required of ['LICENSE.md', 'README.md', '.dev.vars.example']) {
	if (!tracked.includes(required)) {
		fail(`${required} is missing from the repository`);
	}
}

if (failures.length > 0) {
	console.error(`\n✗ Template is not clean — ${failures.length} problem(s):\n`);
	for (const failure of failures) console.error(`  • ${failure}`);
	console.error('\nFix these before releasing. Anyone can read this repository.\n');
	process.exit(1);
}

console.log(`✓ Template is clean — scanned ${tracked.length} tracked files.`);
