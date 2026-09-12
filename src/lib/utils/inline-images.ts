import type { EmailAttachmentMeta } from '$lib/types';
import { attachmentHref } from './attachments';

/**
 * Inline images arrive as `<img src="cid:ii_123@mail">` — a reference to a MIME
 * part by Content-ID, which a browser cannot resolve. Point them at the stored
 * attachment instead, or the message renders with a broken image where the
 * sender put a screenshot.
 */

// Only the reference itself is replaced, never the quote or bracket around it.
// The lookbehind keeps the rewrite to attribute and url() positions, so the
// characters "cid:" sitting in ordinary prose are left as written.
const CID_REFERENCE = /(?<=["'(=])cid:([^"')\s>]+)/gi;

function bare(value: string): string {
	let text = value.trim();
	try {
		text = decodeURIComponent(text);
	} catch {
		// A stray percent sign is not an encoding — compare what we were given.
	}
	return text.replace(/^<|>$/g, '').trim().toLowerCase();
}

function isImage(attachment: EmailAttachmentMeta): boolean {
	return attachment.content_type.toLowerCase().startsWith('image/');
}

/**
 * Messages stored before Content-ID was kept have nothing to match on. When the
 * body asks for exactly one image and exactly one image was stored, the pairing
 * is unambiguous; anything less certain is left alone rather than guessed at.
 */
function soleImageFallback(
	html: string,
	attachments: EmailAttachmentMeta[]
): EmailAttachmentMeta | null {
	const referenced = new Set<string>();
	for (const match of html.matchAll(CID_REFERENCE)) referenced.add(bare(match[1]));
	if (referenced.size !== 1) return null;

	const images = attachments.filter(isImage);
	return images.length === 1 ? images[0] : null;
}

export function resolveInlineImages(
	html: string | null | undefined,
	emailId: string,
	attachments: EmailAttachmentMeta[]
): string {
	if (!html) return '';
	if (!html.toLowerCase().includes('cid:')) return html;

	const byContentId = new Map<string, EmailAttachmentMeta>();
	for (const attachment of attachments) {
		if (attachment.content_id) byContentId.set(bare(attachment.content_id), attachment);
	}

	// Only mail stored before the Content-ID column existed may be paired by
	// guesswork. Once any part carries one, an unmatched reference is a genuine
	// miss — a quoted `cid:` from a forwarded original, say — and substituting
	// the one image that happens to be attached would show the wrong picture
	// with nothing to give it away.
	const fallback = byContentId.size === 0 ? soleImageFallback(html, attachments) : null;

	return html.replace(CID_REFERENCE, (whole, reference: string) => {
		const match = byContentId.get(bare(reference)) ?? fallback;
		return match ? attachmentHref(emailId, match.id) : whole;
	});
}
