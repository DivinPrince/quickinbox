import { error, type RequestHandler } from '@sveltejs/kit';
import { getUserAvatarByEmail, resolveContactAvatar } from '$lib/server/avatars';

/**
 * The one image URL the UI ever points at. A local user's uploaded picture wins;
 * failing that we try the public sources. A 404 is a normal answer -- the client
 * draws initials instead -- so it is cached like a hit.
 */
export const GET: RequestHandler = async ({ params, locals, platform, setHeaders }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) throw error(401, 'Unauthorized');

	const email = decodeURIComponent(params.email ?? '').trim();
	if (!email || !email.includes('@')) throw error(400, 'Invalid address');

	let avatar = await getUserAvatarByEmail(db, bucket, email);

	// Only reach off-box when the signed-in user has left that switched on.
	if (!avatar && locals.user.external_avatars) {
		avatar = await resolveContactAvatar(db, bucket, email);
	}

	if (!avatar) throw error(404, 'No avatar');

	setHeaders({ 'cache-control': 'private, max-age=3600' });

	return new Response(avatar.body, {
		headers: {
			'content-type': avatar.contentType,
			'content-length': String(avatar.body.byteLength),
			// A BIMI logo is third-party SVG. Rendered in an <img> it is inert, but
			// these make it inert on direct navigation too.
			'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
			'x-content-type-options': 'nosniff'
		}
	});
};
