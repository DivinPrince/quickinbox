import { MAX_ATTACHMENT_BYTES } from '$lib/constants';
import type { OutboundAttachmentInput } from '$lib/types';

export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export class InlineImageError extends Error {
	constructor(readonly reason: 'format' | 'size' | 'empty') {
		super(reason);
	}
}

/** Keep image bytes out of the HTML: providers send them as CID MIME parts. */
export async function createInlineImage(file: File): Promise<OutboundAttachmentInput> {
	if (!INLINE_IMAGE_TYPES.includes(file.type)) throw new InlineImageError('format');
	if (file.size > MAX_ATTACHMENT_BYTES) throw new InlineImageError('size');
	if (!file.size) throw new InlineImageError('empty');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return {
		filename: file.name || `image.${file.type === 'image/jpeg' ? 'jpg' : file.type.slice(6)}`,
		type: file.type,
		content: btoa(binary),
		disposition: 'inline',
		contentId: `${crypto.randomUUID()}@quickinbox`
	};
}
