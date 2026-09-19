#!/usr/bin/env node
/**
 * Reset a user's password in remote (or local) D1.
 * Usage: bun scripts/reset-admin-password.mjs <email> <password> [--local]
 */
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const PBKDF2_ITERATIONS = 100_000;

// Read the D1 name out of wrangler.jsonc so this keeps working if you rename it.
const wranglerPath = new URL('../wrangler.jsonc', import.meta.url);
const databaseName = readFileSync(wranglerPath, 'utf8').match(
	/"database_name"\s*:\s*"([^"]+)"/
)?.[1];

if (!databaseName) {
	console.error('Could not find "database_name" in wrangler.jsonc.');
	process.exit(1);
}

function toBase64(bytes) {
	return Buffer.from(bytes).toString('base64');
}

async function hashPassword(password) {
	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const hash = new Uint8Array(
		await subtle.deriveBits(
			{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
			keyMaterial,
			256
		)
	);
	return `${toBase64(salt)}:${toBase64(hash)}`;
}

const [email, password] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const local = process.argv.includes('--local');

function usage(message) {
	console.error(message);
	console.error('\nUsage: bun scripts/reset-admin-password.mjs <email> <password> [--local]');
	process.exit(1);
}

if (!email?.includes('@')) usage('A valid login email is required.');
if (!password || password.length < 8) usage('Password must be at least 8 characters.');

const passwordHash = await hashPassword(password);
const escape = (value) => value.replace(/'/g, "''");
const emailSql = `'${escape(email.trim().toLowerCase())}'`;
const sql = [
 `UPDATE users SET password_hash = '${escape(passwordHash)}' WHERE email = ${emailSql};`,
 ...['sessions', 'api_tokens', 'pairing_codes', 'oauth_codes', 'oauth_grants', 'mfa_enrollments'].map(
  (table) => `DELETE FROM ${table} WHERE user_id IN (SELECT id FROM users WHERE email = ${emailSql});`
)].join('\n');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'quickinbox-reset-'));
try {
 const sqlFile = join(temporaryDirectory, 'reset.sql');
 writeFileSync(sqlFile, sql, { mode: 0o600 });
 execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'd1', 'execute', databaseName, local ? '--local' : '--remote', '--file', sqlFile],
  { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) });
} finally {
 rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`\nPassword reset for ${email} (${local ? 'local' : 'remote'} DB).`);
