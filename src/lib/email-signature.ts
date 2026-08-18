export const MAX_EMAIL_SIGNATURE_LENGTH = 1000;

/** Keep intentional line breaks while removing transport and trailing whitespace noise. */
export function normalizeEmailSignature(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** Append the configured sign-off to both MIME alternatives exactly once at send time. */
export function appendEmailSignature(input: {
	text: string;
	html: string | null;
	signature: string;
}): { text: string; html: string | null } {
	const signature = normalizeEmailSignature(input.signature);
	if (!signature) return { text: input.text, html: input.html };

	const text = `${input.text.trimEnd()}\n\n${signature}`;
	const html = input.html
		? `${input.html.trimEnd()}\n<div><br></div>\n<div data-email-signature="true">${escapeHtml(signature).replaceAll('\n', '<br>\n')}</div>`
		: null;

	return { text, html };
}
