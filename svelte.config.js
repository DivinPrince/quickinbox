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
		})
	}
};

export default config;
