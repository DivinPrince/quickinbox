export function isImageType(contentType: string): boolean {
	return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon'].includes(contentType.toLowerCase().split(';', 1)[0].trim());
}

export function isPreviewableInline(contentType: string): boolean {
	return (
		isImageType(contentType) ||
		contentType === 'application/pdf' ||
		contentType === 'text/plain' ||
		contentType === 'application/json'
	);
}

export function attachmentHref(emailId: string, attachmentId: string, download = false): string {
	const base = `/api/mail/${emailId}/attachments/${attachmentId}`;
	return download ? `${base}?download=1` : base;
}

export function attachmentIcon(contentType: string): string {
	if (isImageType(contentType)) return 'image-line';
	if (contentType === 'application/pdf') return 'file-pdf-line';
	if (contentType.startsWith('text/')) return 'file-text-line';
	if (contentType.includes('zip') || contentType.includes('compressed')) return 'file-zip-line';
	return 'file-3-line';
}
