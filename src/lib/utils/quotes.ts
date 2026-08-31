/**
 * Collapsing quoted history inside a rendered message.
 *
 * A reply carries the whole conversation below it. Left alone that turns a
 * three-word answer into a wall of text, so the quoted part is folded behind a
 * "…" toggle — the same affordance every mail client offers.
 *
 * This runs on the rendered DOM rather than on the stored HTML: mail bodies are
 * full of unbalanced markup, and re-serializing them would risk mangling the
 * message. Nothing is removed, only hidden.
 *
 * HTML messages render inside their own frame, so the container passed in
 * usually belongs to that document rather than to the app's.
 */

/** What mail clients wrap quoted history in. */
const QUOTE_SELECTORS = [
	'blockquote[type="cite"]',
	'.gmail_quote',
	'.gmail_quote_container',
	'.yahoo_quoted',
	'#appendonsend',
	'div[id^="divRplyFwdMsg"]',
	'blockquote'
].join(', ');

/** "On Tue, Jul 28, 2026 at 3:36 AM Someone <a@b> wrote:" */
const ATTRIBUTION = /^\s*on\b[\s\S]{0,300}\bwrote:\s*$/i;

/**
 * A whole document or a table layout uses these same wrappers as ordinary
 * structure, so folding on them there hides the message rather than its
 * history. Left intact instead — the native clients make the same call.
 */
export function canFoldQuotes(html: string): boolean {
	return !/<(?:html|table)\b/i.test(html);
}

/** Text and images that survive the fold, so we can tell if any would. */
function remainsVisible(container: HTMLElement, hidden: Element[]): boolean {
	const folded = new Set<Element>(hidden);
	let text = '';
	let image = false;

	const walk = (node: Node) => {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;
			if (folded.has(element)) return;
			if (element.tagName === 'IMG') image = true;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? '';
			return;
		}
		for (const child of Array.from(node.childNodes)) walk(child);
	};
	walk(container);

	return image || text.trim() !== '';
}

/**
 * Where quoted history starts in a plain-text body. Used for list previews and
 * for messages that arrived without HTML.
 */
export function splitQuotedText(text: string): { body: string; quoted: string } {
	const lines = text.split(/\r?\n/);

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();

		// The attribution line often wraps onto the next one.
		const attribution =
			/^on\b/i.test(line) &&
			ATTRIBUTION.test(`${line} ${(lines[index + 1] ?? '').trim()}`.slice(0, 400));

		if (
			line.startsWith('>') ||
			attribution ||
			/^-{2,}\s*(original|forwarded) message/i.test(line) ||
			/^-{3,}\s*$/.test(line) ||
			/^_{5,}\s*$/.test(line) ||
			/^begin forwarded message:/i.test(line)
		) {
			const body = lines.slice(0, index).join('\n').trim();
			// A message that is nothing but a quote keeps its text; there is
			// nothing else to show.
			if (!body) break;
			return { body, quoted: lines.slice(index).join('\n').trim() };
		}
	}

	return { body: text.trim(), quoted: '' };
}

/** The message's own words, with any quoted history dropped. */
export function stripQuotedText(text: string): string {
	return splitQuotedText(text).body;
}

/**
 * Hides the quoted history and hands the folded elements back, so the caller
 * can offer a control that reveals them again.
 *
 * The control deliberately lives outside this function: the message frame has
 * scripting disabled by its sandbox, and WebKit will not run a listener bound
 * to a node in such a document even when the listener itself comes from out
 * here. A button placed in the frame is therefore dead in Safari. Callers own
 * the toggle in their own document instead; mutating the frame's DOM from the
 * outside — which is all revealing takes — works everywhere.
 */
export function foldQuotedHtml(container: HTMLElement): Element[] {
	// The nodes belong to another document, so `instanceof HTMLElement` would be
	// false for every one of them. They stay typed as Element throughout.
	if (container.dataset.quotesFolded === 'true') {
		return Array.from(container.querySelectorAll('.quote-hidden'));
	}
	container.dataset.quotesFolded = 'true';

	const quote = container.querySelector<HTMLElement>(QUOTE_SELECTORS);
	if (!quote) return [];

	// Anything after the first quote belongs to the history too, as does the
	// "On … wrote:" line that introduces it.
	const hidden: Element[] = [];
	let anchor: Element = quote;

	const previous = quote.previousElementSibling;
	if (previous && ATTRIBUTION.test(previous.textContent ?? '')) {
		anchor = previous;
	}

	for (let node: Element | null = anchor; node; node = node.nextElementSibling) {
		hidden.push(node);
	}

	// A bare forward is all quote and no words. Folding it would leave an empty
	// message behind a toggle, so it is shown whole instead.
	if (!remainsVisible(container, hidden)) return [];

	for (const node of hidden) node.classList.add('quote-hidden');

	return hidden;
}
