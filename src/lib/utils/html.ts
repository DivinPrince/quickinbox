export function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function isHtmlEmpty(html: string): boolean {
	const text = htmlToPlainText(html);
	return !text && !html.includes('<img');
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
