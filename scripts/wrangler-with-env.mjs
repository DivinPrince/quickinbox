#!/usr/bin/env node
/**
 * Run wrangler with CLOUDFLARE_ACCOUNT_ID (and other Cloudflare auth vars)
 * loaded from `.env` / `.dev.vars` when the shell has not already set them.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCloudflareAuthEnv } from './cloudflare-env.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const texts = [];
for (const name of ['.env', '.dev.vars']) {
	const file = join(root, name);
	if (existsSync(file)) texts.push(readFileSync(file, 'utf8'));
}
applyCloudflareAuthEnv(process.env, texts);

const wrangler = join(
	root,
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
const command = existsSync(wrangler) ? wrangler : 'wrangler';
const child = spawn(command, process.argv.slice(2), {
	stdio: 'inherit',
	cwd: root,
	env: process.env
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
