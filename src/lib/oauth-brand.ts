/**
 * Real logos for the MCP clients people actually connect. Dynamic registration
 * rarely ships a `logo_uri`, so without this the consent screen would show a
 * grey square with two letters in it. Icons are Remix Icon brand glyphs, which
 * the app already bundles.
 */

export type ClientBrand = {
	/** Remix Icon name (without the `ri-` prefix). */
	icon: string;
	/** Canonical product name, used when the registered name is a slug. */
	label: string;
	/** Tile background; the glyph is drawn in white on top. */
	color: string;
};

const BRANDS: Array<ClientBrand & { match: RegExp }> = [
	{ match: /claude|anthropic/, icon: 'claude-fill', label: 'Claude', color: '#d97757' },
	{ match: /cursor/, icon: 'cursor-ai-fill', label: 'Cursor', color: '#111111' },
	{ match: /chatgpt|openai|codex/, icon: 'openai-fill', label: 'ChatGPT', color: '#111111' },
	{ match: /copilot/, icon: 'copilot-fill', label: 'GitHub Copilot', color: '#24292f' },
	{ match: /github/, icon: 'github-fill', label: 'GitHub', color: '#24292f' },
	{ match: /gemini|google/, icon: 'gemini-fill', label: 'Gemini', color: '#1a73e8' },
	{ match: /perplexity/, icon: 'perplexity-fill', label: 'Perplexity', color: '#20808d' },
	{ match: /vs ?code|visual studio|microsoft/, icon: 'microsoft-fill', label: 'Visual Studio Code', color: '#0078d4' },
	{ match: /slack/, icon: 'slack-fill', label: 'Slack', color: '#4a154b' },
	{ match: /notion/, icon: 'notion-fill', label: 'Notion', color: '#111111' },
	{ match: /discord/, icon: 'discord-fill', label: 'Discord', color: '#5865f2' },
	{ match: /inspector|mcp-remote|\bcli\b|terminal|localhost|127\.0\.0\.1/, icon: 'terminal-box-line', label: 'Local client', color: '#4b5563' }
];

export type BrandableClient = {
	client_name: string;
	client_uri?: string | null;
	client_id?: string | null;
};

/** Which well-known product this client is, if any. */
export function clientBrand(client: BrandableClient): ClientBrand | null {
	const haystack = [client.client_name, client.client_uri ?? '', client.client_id ?? '']
		.join(' ')
		.toLowerCase();
	for (const brand of BRANDS) {
		if (brand.match.test(haystack)) {
			const { match: _match, ...rest } = brand;
			return rest;
		}
	}
	return null;
}

/** Two-letter fallback for clients we do not recognise. */
export function clientInitials(name: string): string {
	const words = name
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** Human-readable host for "you'll be sent back to …". */
export function redirectHost(redirectUri: string): string {
	try {
		const url = new URL(redirectUri);
		if (url.protocol === 'http:' || url.protocol === 'https:') return url.host;
		// cursor://anysphere.cursor-retrieval/… → "cursor"
		return url.protocol.replace(/:$/, '');
	} catch {
		return redirectUri;
	}
}
