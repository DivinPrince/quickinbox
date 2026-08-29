import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			config: 'wrangler.jsonc',
			platformProxy: {
				configPath: 'wrangler.jsonc',
				persist: { path: '.wrangler/state/v3' }
			}
		}),
		// Vite's unbundled worker fails in the browser. Production registration
		// lives in registerAppServiceWorker().
		alias: {
			$themes: 'src/themes'
		},
		serviceWorker: {
			register: false
		}
	}
};

export default config;
