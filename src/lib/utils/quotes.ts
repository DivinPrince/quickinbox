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

export function foldQuotedHtml(container: HTMLElement): void {
	if (container.dataset.quotesFolded === 'true') return;
	container.dataset.quotesFolded = 'true';

	const quote = container.querySelector<HTMLElement>(QUOTE_SELECTORS);
	if (!quote) return;

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

	if (hidden.length === 0) return;

	// The container may live in the message frame's document, not this one.
	const toggle = (container.ownerDocument ?? document).createElement('button');
	toggle.type = 'button';
	toggle.className = 'quote-toggle';
	toggle.textContent = '···';
	toggle.setAttribute('aria-label', 'Show quoted text');
	toggle.setAttribute('aria-expanded', 'false');

	anchor.parentNode?.insertBefore(toggle, anchor);
	for (const node of hidden) node.classList.add('quote-hidden');

	toggle.addEventListener('click', () => {
		const showing = toggle.getAttribute('aria-expanded') === 'true';
		for (const node of hidden) node.classList.toggle('quote-hidden', showing);
		toggle.setAttribute('aria-expanded', showing ? 'false' : 'true');
		toggle.setAttribute('aria-label', showing ? 'Show quoted text' : 'Hide quoted text');
	});
}
