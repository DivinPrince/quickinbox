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

/** Applies to both modes: sizing, wrapping and the quote toggle. */
const BASE_CSS = `
/* The frame is sized to its content from the outside, so percentage heights
   inside would feed back into that measurement. */
html, body { height: auto !important; }
/* A frame paints an opaque white canvas unless the document opts out, which is
   what put a white sheet under plain replies. A transparent background alone is
   not enough: a frame whose colour scheme differs from its embedder's is denied
   transparency and painted in its own scheme instead, so the scheme has to be
   declared in here too — see the dark rule below. */
html { overflow-x: auto; overflow-y: hidden; background: transparent; }
html:not([data-theme='dark']) { color-scheme: light; }
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
.quote-toggle {
	display: inline-flex;
	align-items: center;
	margin: 0.5rem 0;
	padding: 0 8px;
	border: 0;
	border-radius: 6px;
	font: inherit;
	font-size: 14px;
	line-height: 1.4;
	letter-spacing: 0.08em;
	cursor: pointer;
}
.quote-hidden { display: none !important; }
`;

/** Ordinary correspondence: the app's colours, the app's background. */
const SIMPLE_CSS = `
body { color: #525252; background: transparent; }
img, video, svg { max-width: 100%; height: auto; }
table { max-width: 100%; }
a { color: #4f6b58; }
blockquote { border-color: rgba(0, 0, 0, 0.12) !important; }
.quote-toggle { color: #525252; background: #f0f0f0; }
.quote-toggle:hover { background: #e6e6e6; }

/*
 * Dark mode. A message written on a white page carries near-black text, which
 * has to give way to the theme's own or it is unreadable here. Inline styles
 * outrank stylesheets, hence !important.
 */
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-theme='dark'] body { color: #a8a8b3 !important; background-color: transparent !important; }
:root[data-theme='dark'] body *:not(a):not(.quote-toggle) {
	color: inherit !important;
	background-color: transparent !important;
	background-image: none !important;
}
:root[data-theme='dark'] a { color: #a8c2b0 !important; }
:root[data-theme='dark'] blockquote { border-color: rgba(255, 255, 255, 0.16) !important; }
:root[data-theme='dark'] .quote-toggle { color: #a8a8b3; background: #2b2b31; }
:root[data-theme='dark'] .quote-toggle:hover { background: #3a3a42; }
`;

/**
 * A designed message renders on the white page it was built for, in either
 * theme — the same thing Gmail does. Recolouring its parts one by one loses the
 * relationships between the sender's colours, and inverting the whole rendering
 * does not work either: a body background propagates to the frame's canvas,
 * which is painted outside the filtered element, so the page stays light while
 * its contents flip.
 */
const RICH_CSS = `
body { color: #18181b; background: #ffffff; padding: 18px 20px; }
a { color: #1a56db; }
.quote-toggle { color: #52525b; background: #f0f0f0; }
.quote-toggle:hover { background: #e6e6e6; }
`;

export function emailCss(rich: boolean): string {
	return BASE_CSS + (rich ? RICH_CSS : SIMPLE_CSS);
}

/** Senders differ on whether the HTML part is a fragment or a whole document. */
function isFullDocument(html: string): boolean {
	return /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html);
}

export function buildEmailDocument(html: string, options: { rich: boolean }): string {
	// A complete document is left as the sender wrote it — nesting it inside
	// another one drops its <head>, and with it any <style> the layout needs.
	// Its stylesheet is added after load instead.
	if (isFullDocument(html)) return html;

	// `base target=_blank` keeps links from trying to navigate the app, which the
	// sandbox would block outright.
	return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>${emailCss(options.rich)}</style>
</head><body>${html}</body></html>`;
}
