type ImageContext = { origin: string; messageId: string };

/** This classifies the notice only. The iframe's CSP enforces image privacy. */
export function isExternalImage(source: string, { origin, messageId }: ImageContext): boolean {
	const value = source.trim();
	if (!value || value.startsWith('#')) return false;
	try {
		const url = new URL(value, origin);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		return !(messageId && /^[a-zA-Z0-9_-]+$/.test(messageId)
			&& url.origin === new URL(origin).origin
			&& url.pathname.startsWith(`/api/mail/${messageId}/attachments/`));
	} catch { return false; }
}

/** URLs in srcset may contain commas (notably data URLs). Descriptors do not. */
export function srcsetImages(value: string): string[] {
	const sources: string[] = [];
	let position = 0;
	while (position < value.length) {
		while (/[\s,]/.test(value[position] ?? '') && position < value.length) position++;
		const start = position;
		while (position < value.length && !/\s/.test(value[position])) position++;
		const source = value.slice(start, position);
		if (!source) break;
		sources.push(source.replace(/,+$/, ''));
		if (source.endsWith(',')) continue;
		let parentheses = 0;
		while (position < value.length) {
			const char = value[position++];
			if (char === '(') parentheses++;
			else if (char === ')') parentheses--;
			else if (char === ',' && parentheses <= 0) break;
		}
	}
	return sources;
}

export function cssImages(value: string): string[] {
	// CSSOM normally normalizes escapes; cover escaped URL characters as well.
	const decoded = value.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_match, hex: string, char: string) =>
		hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char);
	const urls = [...decoded.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)]
		.map((match) => match[1] ?? match[2] ?? match[3]);
	// image-set permits quoted URLs without wrapping them in url().
	for (const set of decoded.matchAll(/(?:-webkit-)?image-set\(([^;}]*)/gi)) {
		for (const quoted of set[1].matchAll(/(?:^|,)\s*(?:"([^"]*)"|'([^']*)')/g)) urls.push(quoted[1] ?? quoted[2]);
	}
	return urls;
}

/** Inspect the document already rendered under CSP; never parse mail in a fetching document. */
export function hasExternalImages(doc: Document, context: ImageContext): boolean {
	const external = (value: string | null) => Boolean(value && isExternalImage(value, context));
	for (const node of doc.querySelectorAll('img, source, input[type="image"], image, video[poster], [background]')) {
		if (external(node.getAttribute('src')) || external(node.getAttribute('background')) || external(node.getAttribute('poster'))) return true;
		if (node.localName === 'image' && external(node.getAttribute('href') ?? node.getAttribute('xlink:href'))) return true;
		if (srcsetImages(node.getAttribute('srcset') ?? '').some(external)) return true;
	}
	const externalCss = (css: string) => cssImages(css).some(external);
	for (const node of doc.querySelectorAll<HTMLElement>('[style]')) {
		if (externalCss(node.style?.cssText ?? node.getAttribute('style') ?? '')) return true;
	}
	const checkRules = (rules: CSSRuleList): boolean => {
		for (const rule of rules) {
			if (rule.type === 5) continue; // Fonts stay blocked independently of image consent.
			if ('style' in rule && externalCss((rule as CSSStyleRule).style.cssText)) return true;
			if ('cssRules' in rule && checkRules((rule as CSSGroupingRule).cssRules)) return true;
		}
		return false;
	};
	for (const sheet of doc.styleSheets) {
		try { if (checkRules(sheet.cssRules)) return true; }
		catch { /* External stylesheets are blocked by CSP. */ }
	}
	return false;
}
