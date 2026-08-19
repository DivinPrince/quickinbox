import { json, type RequestHandler } from '@sveltejs/kit';
import {
	MAX_AVATAR_BYTES,
	deleteUserAvatar,
	detectImageType,
	storeUserAvatar
} from '$lib/server/avatars';

/** Upload or replace the signed-in user's own picture. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const form = await request.formData().catch(() => null);
	const file = form?.get('avatar');
	if (!(file instanceof File)) {
		return json({ error: 'Attach an image as "avatar"' }, { status: 400 });
	}
	if (file.size > MAX_AVATAR_BYTES) {
		return json(
			{ error: `Image must be under ${Math.floor(MAX_AVATAR_BYTES / 1024)}KB` },
			{ status: 413 }
		);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	// Trust the bytes, not the Content-Type the browser attached to them.
	const contentType = detectImageType(bytes);
	if (!contentType) {
		return json({ error: 'Only PNG, JPEG, GIF or WebP images are supported' }, { status: 415 });
	}

	await storeUserAvatar(db, bucket, locals.user.id, bytes, contentType);
	return json({ ok: true, email: locals.user.email });
};

/** Remove it and fall back to initials. */
export const DELETE: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	await deleteUserAvatar(db, bucket, locals.user.id);
	return json({ ok: true });
};
