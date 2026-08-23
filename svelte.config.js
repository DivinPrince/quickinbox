import adapter from '@sveltejs/adapter-cloudflare';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWranglerConfig } from './scripts/wrangler-config.mjs';

const wrangler = resolveWranglerConfig(dirname(fileURLToPath(import.meta.url)));

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			config: wrangler.file,
			platformProxy: {
				configPath: wrangler.file,
				persist: { path: '.wrangler/state/v3' }
			}
		}),
		// Vite's unbundled worker fails in the browser. Production registration
		// lives in registerAppServiceWorker().
		serviceWorker: {
			register: false
		}
	}
};

export default config;
