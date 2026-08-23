export function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Decode tags and whitespace entities when DOMParser is unavailable (SSR). */
function stripMarkup(html: string): string {
	return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(
		/&#(x)?([0-9a-f]+);/gi,
		(_match, hex: string | undefined, value: string) => {
			const code = Number.parseInt(value, hex ? 16 : 10);
			return Number.isNaN(code) ? '' : String.fromCharCode(code);
		}
	);
}

export function isHtmlEmpty(html: string): boolean {
	if (!html.trim()) return true;
	if (html.includes('<img')) return false;
	// Derived emptiness is evaluated during SSR, where DOMParser is unavailable.
	if (typeof DOMParser === 'undefined') {
		return !stripMarkup(html).trim();
	}
	return !htmlToPlainText(html);
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
