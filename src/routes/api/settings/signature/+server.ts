import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';
import { updateEmailSignature } from '$lib/server/email-signature';

export const PATCH: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { signature?: unknown };
	try {
		body = (await request.json()) as { signature?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (typeof body.signature !== 'string') {
		return json({ error: 'Signature must be text' }, { status: 400 });
	}
	if (body.signature.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		return json(
			{ error: `Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer` },
			{ status: 400 }
		);
	}

	const signature = await updateEmailSignature(db, locals.user.id, body.signature);
	return json({ ok: true, signature });
};
