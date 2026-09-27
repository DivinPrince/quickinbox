import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { sendForwardedMessages, type ForwardRequest } from '$lib/server/forward-mail';
import { getEmailForUser } from '$lib/server/mail-store';
import { readIdempotencyKey } from '$lib/server/send-attempts';
import { apiSendPolicyFor } from '$lib/server/send-policy';
import { parseRecipients } from '$lib/server/send-mail';

/** Sends a copy of a message on to someone who has not seen it. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const original = await getEmailForUser(db, locals.user.id, params.id!);
	if (!original) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const idempotencyKey = readIdempotencyKey(request);
	if (idempotencyKey === null) {
		return json({ error: 'Invalid Idempotency-Key' }, { status: 400 });
	}

	const body = (await request.json()) as ForwardRequest;
	if (parseRecipients(body.to).length === 0) {
		return json({ error: 'A recipient is required' }, { status: 400 });
	}

	// A forward goes to someone outside the original exchange, so it starts its
	// own conversation rather than continuing that one — no In-Reply-To chain.
	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendForwardedMessages(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			[original],
			{
				...body,
				idempotencyKey,
				apiPolicy: apiSendPolicyFor(locals.authMethod, platform?.env)
			}
		);

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to forward message') },
			{ status: statusForProviderError(error) }
		);
	}
};
