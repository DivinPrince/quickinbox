#!/usr/bin/env node
/**
 * Run wrangler with:
 * 1. CLOUDFLARE_ACCOUNT_ID (and related auth) loaded from `.env` / `.dev.vars`
 *    when the shell has not already set them.
 * 2. `--config wrangler.deploy.jsonc` when that private file exists, so a
 *    personal mailbox deploy can track latest QuickMail without committing
 *    account ids / D1 ids / hostnames into the public template.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCloudflareAuthEnv } from './cloudflare-env.mjs';
import { wranglerArgsWithConfig } from './wrangler-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const texts = [];
for (const name of ['.env', '.dev.vars']) {
	const file = join(root, name);
	if (existsSync(file)) texts.push(readFileSync(file, 'utf8'));
}
applyCloudflareAuthEnv(process.env, texts);

const { args, config } = wranglerArgsWithConfig(root, process.argv.slice(2));
if (config.private && !process.env.QUICKMAIL_WRANGLER_QUIET) {
	console.error(`Using private Wrangler config: ${config.file}`);
}

const wrangler = join(
	root,
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
const command = existsSync(wrangler) ? wrangler : 'wrangler';
const child = spawn(command, args, {
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
