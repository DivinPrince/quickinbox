import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { sendForwardedMessages, type ForwardRequest } from '$lib/server/forward-mail';
import { listForwardThreadMessages } from '$lib/server/mail-store';
import { readIdempotencyKey } from '$lib/server/send-attempts';
import { parseRecipients } from '$lib/server/send-mail';

/** Forward every message in an authenticated user's conversation, oldest first. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const messages = await listForwardThreadMessages(db, locals.user.id, params.threadId!);
	if (messages.length === 0) {
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

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendForwardedMessages(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			messages,
			{ ...body, idempotencyKey }
		);

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to forward conversation') },
			{ status: statusForProviderError(error) }
		);
	}
};
