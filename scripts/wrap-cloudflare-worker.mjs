#!/usr/bin/env node
/**
 * adapter-cloudflare writes the SvelteKit fetch worker to wrangler `main`
 * (`.svelte-kit/cloudflare/_worker.js`). We keep that path so the adapter
 * does not overwrite `src/worker.ts`, then wrap the generated file with
 * Cloudflare Email Service's `email()` handler.
 */
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MARKER = '__QUICKINBOX_EMAIL_WRAPPER__';
const LEGACY_MARKER = '__QUICKMAIL_EMAIL_WRAPPER__';
const generated = path.resolve('.svelte-kit/cloudflare/_worker.js');
const sveltekit = path.resolve('.svelte-kit/cloudflare/_sveltekit.js');

if (!existsSync(generated)) {
	throw new Error('Expected .svelte-kit/cloudflare/_worker.js after `vite build`.');
}

const current = await readFile(generated, 'utf8');
if (current.includes(MARKER) || current.includes(LEGACY_MARKER)) {
	process.exit(0);
}

await rename(generated, sveltekit);

await writeFile(
	generated,
	`/* ${MARKER} */
export { default } from '../../src/worker.ts';
`
);
