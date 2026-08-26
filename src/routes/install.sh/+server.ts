import type { RequestHandler } from '@sveltejs/kit';

const GITHUB_REPO = 'DivinPrince/quickinbox';
/** Public installer lives on main; set QUICKINBOX_REF in the script to use another ref. */
const GITHUB_REF = 'main';

function isSafeOrigin(origin: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		return false;
	}
	if (parsed.origin !== origin) return false;
	if (parsed.protocol === 'https:') return true;
	return (
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
	);
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export const GET: RequestHandler = ({ url }) => {
	const origin = isSafeOrigin(url.origin) ? url.origin : '';
	const installUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_REF}/scripts/install.sh`;
	const exportLine = origin
		? `export QUICKINBOX_URL="\${QUICKINBOX_URL:-${shellSingleQuote(origin)}}"\n`
		: '';

	const body = `#!/usr/bin/env bash
set -euo pipefail
${exportLine}curl -fsSL ${shellSingleQuote(installUrl)} | bash
`;

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Disposition': 'inline; filename="install.sh"'
		}
	});
};
