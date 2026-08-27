import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachmentForUser, readAttachmentBytes } from '$lib/server/attachments';
import { isPreviewableInline } from '$lib/utils/attachments';

export const GET: RequestHandler = async ({ params, locals, platform, url }) => {
	if (!locals.user || !platform?.env.DB || !platform?.env.ATTACHMENTS) {
		throw error(401, 'Unauthorized');
	}

	const attachment = await getAttachmentForUser(
		platform.env.DB,
		locals.user.id,
		params.id,
		params.attachmentId
	);

	if (!attachment) {
		throw error(404, 'Attachment not found');
	}

	const bytes = await readAttachmentBytes(platform.env.ATTACHMENTS, attachment);
	if (!bytes) {
		throw error(404, 'Attachment not found');
	}

	const forceDownload = url.searchParams.get('download') === '1';
	const inline = !forceDownload && isPreviewableInline(attachment.content_type);

	const body = new Uint8Array(bytes);

	return new Response(body, {
		headers: {
			'Content-Type': attachment.content_type,
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.filename)}"`,
			'Content-Length': String(bytes.length),
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
