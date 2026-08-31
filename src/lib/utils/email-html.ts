/**
 * Preparing a received message for display.
 *
 * Email HTML is not page HTML. It arrives with fixed pixel heights, layout
 * tables, absolutely positioned chips and inline colours that assume a white
 * page — and it was written for a renderer that is not this app. Dropped
 * straight into the document it fights our stylesheet in both directions: our
 * line-height overflows its fixed boxes, its colours ignore our theme.
 *
 * So it is rendered inside its own document instead, and this module builds
 * that document.
 */

/**
 * Was the message laid out, or just written? Anything with a layout is shown
 * as its sender designed it — on white, untouched. Ordinary correspondence is
 * shown in the app's own colours, so a reply reads like part of the thread
 * rather than a sheet of paper dropped into it.
 */
const LAYOUT_MARKERS = [
	/<table[\s>]/i,
	/<style[\s>]/i,
	/\sbgcolor\s*=/i,
	/background(-color)?\s*:\s*(?!\s*(transparent|none|inherit|initial|unset)\b)/i,
	/position\s*:\s*(absolute|fixed)/i,
	/<center[\s>]/i
];

/** Where the sender's own words end and the conversation history begins. */
const QUOTE_BOUNDARY = [
	/<blockquote/i,
	/class\s*=\s*["'][^"']*gmail_quote/i,
	/class\s*=\s*["'][^"']*yahoo_quoted/i,
	/id\s*=\s*["']?appendonsend/i,
	/id\s*=\s*["']?divRplyFwdMsg/i,
	/-{2,}\s*original message/i
];

/**
 * A reply is judged on what its sender wrote, not on what they quoted. Reply to
 * a message containing a designed element and the quote carries that markup
 * along — which would otherwise class every answer in the thread as designed.
 */
function ownContent(html: string): string {
	let cut = html.length;

	for (const marker of QUOTE_BOUNDARY) {
		const match = marker.exec(html);
		if (match && match.index < cut) cut = match.index;
	}

	// A bare forward is all quote and no words; judge it whole.
	return cut > 30 ? html.slice(0, cut) : html;
}

export function isRichHtml(html: string): boolean {
	const own = ownContent(html);
	return LAYOUT_MARKERS.some((marker) => marker.test(own));
}

/**
 * Did the sender design a dark version? Theirs is shown untouched when so, and
 * a message without one is recoloured instead. A bare `color-scheme`
 * declaration does not count: it opts into the client adapting the message,
 * not into colours the sender picked.
 */
export function supportsDarkScheme(html: string): boolean {
	return /@media[^{]{0,240}\(\s*prefers-color-scheme\s*:\s*dark\s*\)|light-dark\s*\(/i.test(html);
}

/**
 * A declaration ends at a semicolon or a brace — but in markup it also ends at
 * the quote closing the style attribute. Without that, `color:#111"><td
 * style="background:#fff` reads as one long colour declaration and the
 * background is judged as if it were text.
 */
const COLOUR_DECLARATION =
	/\b(background(?:-color)?|color|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?)\s*:[^;}"'<>]*/gi;
const COLOUR_LITERAL =
	/#[0-9a-f]{3,8}|rgba?\([^)]{1,160}\)|\b(?:black|white|darkgray|darkgrey|lightgray|lightgrey)\b/gi;
const HTML_TAG = /<[a-z][^>]{0,8192}>/gi;
const COLOUR_ATTRIBUTE =
	/(^|\s)(bgcolor|color)\s*=\s*(["']?)(#[0-9a-f]{3,8}|rgba?\([^)]{1,160}\)|(?:black|white|darkgray|darkgrey|lightgray|lightgrey))\3/gi;

const NAMED_COLOUR_VALUES: Record<string, [number, number, number, number]> = {
	black: [0, 0, 0, 1],
	white: [1, 1, 1, 1],
	darkgray: [169 / 255, 169 / 255, 169 / 255, 1],
	darkgrey: [169 / 255, 169 / 255, 169 / 255, 1],
	lightgray: [211 / 255, 211 / 255, 211 / 255, 1],
	lightgrey: [211 / 255, 211 / 255, 211 / 255, 1]
};

function rgba(literal: string): [number, number, number, number] | null {
	const value = literal.trim().toLowerCase();

	if (value.startsWith('#')) {
		const hex = value.slice(1);
		const expanded =
			hex.length === 3 || hex.length === 4
				? [...hex].map((digit) => digit + digit).join('') + (hex.length === 3 ? 'ff' : '')
				: hex.length === 6
					? `${hex}ff`
					: hex.length === 8
						? hex
						: null;
		if (!expanded) return null;

		const packed = Number.parseInt(expanded, 16);
		if (Number.isNaN(packed)) return null;
		return [
			((packed >>> 24) & 0xff) / 255,
			((packed >>> 16) & 0xff) / 255,
			((packed >>> 8) & 0xff) / 255,
			(packed & 0xff) / 255
		];
	}

	const named = NAMED_COLOUR_VALUES[value];
	if (named) return named;

	const parts = value
		.replace(/rgba?|\(|\)/g, '')
		.split(/[,/\s]+/)
		.filter(Boolean);
	if (parts.length < 3) return null;

	const channel = (part: string) => {
		const parsed = Number.parseFloat(part);
		if (Number.isNaN(parsed)) return null;
		const normalized = part.endsWith('%') ? parsed / 100 : parsed / 255;
		return Math.min(1, Math.max(0, normalized));
	};
	const alpha = (part: string | undefined) => {
		if (!part) return 1;
		const parsed = Number.parseFloat(part);
		if (Number.isNaN(parsed)) return null;
		const normalized = part.endsWith('%') ? parsed / 100 : parsed;
		return Math.min(1, Math.max(0, normalized));
	};
	const red = channel(parts[0]);
	const green = channel(parts[1]);
	const blue = channel(parts[2]);
	const opacity = alpha(parts[3]);
	if (red === null || green === null || blue === null || opacity === null) return null;
	return [red, green, blue, opacity];
}

/**
 * Near-white pages become the app's surface and near-black text becomes light,
 * while everything in between — the sender's accents, their brand colours — is
 * left exactly as it was. Inverting the whole rendering instead would flip
 * their logos with it.
 */
function darkModeColour(literal: string, property: string): string {
	const parsed = rgba(literal);
	if (!parsed) return literal;

	const [red, green, blue, alpha] = parsed;
	if (alpha < 0.2) return literal;

	const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	const normalized = property.toLowerCase();

	if (normalized.includes('background') || normalized === 'bgcolor') {
		if (luminance > 0.78) return '#1f1f23';
		if (luminance > 0.52) return '#2b2b31';
		return literal;
	}

	if (luminance < 0.25) return '#f2f2f7';
	if (luminance < 0.5) return '#d1d1d6';
	return literal;
}

/** Rewrites colours in markup or a stylesheet for a dark page. */
export function adaptDarkColours(source: string): string {
	const declarationsAdapted = source.replace(COLOUR_DECLARATION, (declaration, property: string) =>
			declaration.replace(COLOUR_LITERAL, (literal: string) =>
				darkModeColour(literal, property)
			)
		);

	return declarationsAdapted.replace(HTML_TAG, (tag) =>
		tag.replace(
			COLOUR_ATTRIBUTE,
			(attribute, _prefix: string, property: string, _quote: string, literal: string) =>
				attribute.replace(literal, darkModeColour(literal, property))
		)
	);
}

/** Applies to both modes: sizing, wrapping and the quote toggle. */
const BASE_CSS = `
/* The frame is sized to its content from the outside, so percentage heights
   inside would feed back into that measurement. */
html, body { height: auto !important; }
/* A frame paints an opaque white canvas unless the document opts out, which is
   what put a white sheet under plain replies. A transparent background alone is
   not enough: a frame whose colour scheme differs from its embedder's is denied
   transparency and painted in its own scheme instead, so each mode below
   declares a scheme of its own to match. */
/* Safari inflates text in a frame on its own judgement; keep the sizes we set. */
html { overflow-x: auto; overflow-y: hidden; background: transparent; -webkit-text-size-adjust: 100%; }
body {
	margin: 0;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	font-size: 15px;
	line-height: 1.65;
	overflow-wrap: anywhere;
}
p { margin: 0 0 1em; }
/* Tailwind's reset is not in here, but senders still rely on markers. */
ul { list-style: disc outside; margin: 0.5em 0; padding-left: 1.5em; }
ol { list-style: decimal outside; margin: 0.5em 0; padding-left: 1.5em; }
pre { white-space: pre-wrap; }
/* Set from outside the frame; the control that clears it lives out there too. */
.quote-hidden { display: none !important; }
`;

/** Ordinary correspondence: the app's colours, the app's background. */
const SIMPLE_CSS = `
html:not([data-theme='dark']) { color-scheme: light; }
body { color: #525252; background: transparent; }
img, video, svg { max-width: 100%; height: auto; }
table { max-width: 100%; }
a { color: #4f6b58; }
blockquote { border-color: rgba(0, 0, 0, 0.12) !important; }

/*
 * Dark mode. A message written on a white page carries near-black text, which
 * has to give way to the theme's own or it is unreadable here. Inline styles
 * outrank stylesheets, hence !important.
 */
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-theme='dark'] body { color: #a8a8b3 !important; background-color: transparent !important; }
:root[data-theme='dark'] body *:not(a) {
	color: inherit !important;
	background-color: transparent !important;
	background-image: none !important;
}
:root[data-theme='dark'] a { color: #a8c2b0 !important; }
:root[data-theme='dark'] blockquote { border-color: rgba(255, 255, 255, 0.16) !important; }
`;

/**
 * A designed message renders on the page its sender built it for. Recolouring
 * its parts one by one loses the relationships between their colours, and
 * inverting the whole rendering does not work either: a body background
 * propagates to the frame's canvas, which is painted outside the filtered
 * element, so the page stays light while its contents flip.
 *
 * Which page that is comes down to the scheme the frame is asked to render in,
 * and that is set from outside — on the <iframe> itself, since a document's
 * `prefers-color-scheme` reflects the embedding element rather than its own
 * root. A sender who wrote no dark styles is pinned to light out there, so the
 * white branch below is the one that runs for them.
 */
const RICH_CSS = `
body { padding: 18px 20px; }
@media (prefers-color-scheme: light) {
	html { color-scheme: light; }
	body { color: #18181b; background: #ffffff; }
	a { color: #1a56db; }
}
/* The sender ships a dark version; leave its colours alone and let it paint. */
@media (prefers-color-scheme: dark) {
	html { color-scheme: dark; }
}
`;

export function emailCss(rich: boolean): string {
	return BASE_CSS + (rich ? RICH_CSS : SIMPLE_CSS);
}

/** Marks our stylesheet so a later pass can tell it is already in place. */
export const EMAIL_STYLE_ID = '__mail-frame-style';

/** Senders differ on whether the HTML part is a fragment or a whole document. */
function isFullDocument(html: string): boolean {
	return /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html);
}

/**
 * The frame is already scriptless by sandbox; this closes off the rest —
 * subresources, embedded frames, form posts. It goes in ahead of anything the
 * sender wrote, because a policy only governs what follows it.
 *
 * Fonts are denied along with everything else, so a message using a hosted
 * webface falls back to the stack below rather than announcing the open to
 * whoever hosts it.
 */
const CSP =
	"default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; " +
	"font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; " +
	"form-action 'none'; base-uri 'none'";

function headStart(): string {
	return `<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">`;
}

/**
 * `base target=_blank` keeps links from trying to navigate the app, which the
 * sandbox would block outright. The viewport matters most on iOS, where a
 * document without one is laid out at a 980px default and comes out shrunken.
 */
function headEnd(rich: boolean): string {
	return `<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style id="${EMAIL_STYLE_ID}">${emailCss(rich)}</style>`;
}

/**
 * `before` goes in ahead of the sender's own head so it governs it; `after`
 * goes in last so our rules outrank theirs.
 */
function spliceHead(html: string, before: string, after: string): string {
	const open = /<head\b[^>]*>/i.exec(html);
	if (open) {
		const at = open.index + open[0].length;
		const withBefore = html.slice(0, at) + before + html.slice(at);

		const closing = withBefore.search(/<\/head\s*>/i);
		return closing === -1
			? withBefore + after
			: withBefore.slice(0, closing) + after + withBefore.slice(closing);
	}

	const root = /<html\b[^>]*>/i.exec(html);
	if (root) {
		const at = root.index + root[0].length;
		return `${html.slice(0, at)}<head>${before}${after}</head>${html.slice(at)}`;
	}

	// A <body> with no <html> around it; give it a root to hang the theme on.
	return `<html><head>${before}${after}</head>${html}`;
}

/** Ours wins: a sender carrying its own data-theme would otherwise pick ours. */
function withTheme(html: string, theme: string): string {
	return html.replace(
		/<html\b[^>]*/i,
		(tag) => `${tag.replace(/\sdata-theme\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, '')} data-theme="${theme}"`
	);
}

export function buildEmailDocument(
	html: string,
	options: { rich: boolean; theme?: string }
): string {
	const theme = options.theme ?? 'light';
	const before = headStart();
	const after = headEnd(options.rich);

	// A designed message written only for a white page is recoloured to suit a
	// dark one. One that brought its own dark styles is left alone, and ordinary
	// correspondence is handled by the stylesheet instead.
	const source =
		options.rich && theme === 'dark' && !supportsDarkScheme(html)
			? adaptDarkColours(html)
			: html;

	// A complete document cannot be nested inside another one — that drops its
	// <head>, and with it any <style> the layout needs. Our own assets are
	// spliced into the head it already has instead. Doing this here rather than
	// after load matters in dark mode: the colour scheme and the transparency
	// opt-out have to be in the very first paint, or the message flashes up as a
	// white sheet while it waits for script.
	if (isFullDocument(source)) return withTheme(spliceHead(source, before, after), theme);

	return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
${before}
${after}
</head><body>${source}</body></html>`;
}
