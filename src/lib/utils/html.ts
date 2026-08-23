export function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function isHtmlEmpty(html: string): boolean {
	if (!html.trim()) return true;
	if (html.includes('<img')) return false;
	// Derived emptiness is evaluated during SSR, where DOMParser is unavailable.
	if (typeof DOMParser === 'undefined') {
		return !html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
	}
	return !htmlToPlainText(html);
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
