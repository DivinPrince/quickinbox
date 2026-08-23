/**
 * Resolve which Wrangler config file to use.
 *
 * The public template ships `wrangler.jsonc` with placeholders. Maintainers
 * (and anyone who keeps a personal mailbox alongside the template) put real
 * account / D1 / route values in `wrangler.deploy.jsonc`, which is gitignored.
 * When that file exists, deploy / migrate / preview use it so pulling latest
 * QuickMail does not wipe personal Cloudflare bindings.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const TEMPLATE_WRANGLER_CONFIG = 'wrangler.jsonc';
export const PRIVATE_WRANGLER_CONFIG = 'wrangler.deploy.jsonc';

/**
 * @param {string} root Absolute project root.
 * @param {{ preferPrivate?: boolean }} [options]
 * @returns {{ path: string, file: string, private: boolean }}
 */
export function resolveWranglerConfig(root, options = {}) {
	const preferPrivate = options.preferPrivate !== false;
	const privatePath = join(root, PRIVATE_WRANGLER_CONFIG);
	if (preferPrivate && existsSync(privatePath)) {
		return { path: privatePath, file: PRIVATE_WRANGLER_CONFIG, private: true };
	}
	return {
		path: join(root, TEMPLATE_WRANGLER_CONFIG),
		file: TEMPLATE_WRANGLER_CONFIG,
		private: false
	};
}

/**
 * Build wrangler argv, injecting `--config <file>` when a private deploy
 * config is active and the caller did not already pass `--config`.
 *
 * @param {string} root
 * @param {string[]} argv
 * @returns {{ args: string[], config: { path: string, file: string, private: boolean } }}
 */
export function wranglerArgsWithConfig(root, argv) {
	const config = resolveWranglerConfig(root);
	const hasConfigFlag = argv.some((arg, i) => {
		if (arg === '--config' || arg === '-c') return true;
		if (arg.startsWith('--config=')) return true;
		if (i > 0 && (argv[i - 1] === '--config' || argv[i - 1] === '-c')) return true;
		return false;
	});
	if (!config.private || hasConfigFlag) {
		return { args: [...argv], config };
	}
	return { args: ['--config', config.file, ...argv], config };
}
