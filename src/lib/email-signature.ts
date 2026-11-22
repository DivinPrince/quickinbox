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

/** Mailbox sign-off wins when set; otherwise the account signature. */
export function pickEmailSignature(
	mailbox: string | null | undefined,
	account: string | null | undefined
): string {
	return normalizeEmailSignature(mailbox ?? '') || normalizeEmailSignature(account ?? '');
}

/** Empty input becomes null so the mailbox falls back to the account signature. */
export function parseMailboxSignature(value: string): string | null {
	const signature = normalizeEmailSignature(value);
	if (signature.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	return signature || null;
}

/**
 * A message that is itself a whole document — it opens with <html> (after any
 * <?xml?>, doctype or comments) and closes with </body> or </html> — rather than a
 * fragment that quotes one (a forward appends the original after the note).
 */
function isCompleteDocument(html: string): boolean {
	let pos = 0;
	for (;;) {
		while (pos < html.length && /\s/.test(html[pos])) pos++;
		if (html.startsWith('<!--', pos)) {
			const end = html.indexOf('-->', pos + 4);
			if (end === -1) return false;
			pos = end + 3;
		} else if (/^<(?:\?xml|!doctype)/i.test(html.slice(pos, pos + 9))) {
			const end = html.indexOf('>', pos);
			if (end === -1) return false;
			pos = end + 1;
		} else {
			break;
		}
	}
	return /^<html[\s>]/i.test(html.slice(pos, pos + 6)) && /<\/(?:body|html)\s*>\s*$/i.test(html);
}

/** The document's own closing tags, anchored at the end so quoted or commented ones never match. */
const DOCUMENT_TAIL = /(?:<\/body\s*>\s*(?:<\/html\s*>\s*)?|<\/html\s*>\s*)$/i;

/** Keep the sign-off inside the document's own <body> so the markup stays well formed. */
function insertBeforeBodyClose(document: string, signatureHtml: string): string {
	const tail = DOCUMENT_TAIL.exec(document);
	if (!tail) return `${document}\n${signatureHtml}`;
	return `${document.slice(0, tail.index)}${signatureHtml}\n${document.slice(tail.index)}`;
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
	const signatureHtml = `<div><br></div>\n<div data-email-signature="true">${escapeHtml(signature).replaceAll('\n', '<br>\n')}</div>`;
	const sourceHtml = input.html?.trimEnd() ?? '';
	const html = sourceHtml
		? isCompleteDocument(sourceHtml)
			? insertBeforeBodyClose(sourceHtml, signatureHtml)
			: `${sourceHtml}\n${signatureHtml}`
		: null;

	return { text, html };
}
