import { json, type RequestHandler } from '@sveltejs/kit';
import { readOutboundAttachments } from '$lib/server/attachments';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { buildForwardedMessage } from '$lib/server/forward';
import { getEmailForUser } from '$lib/server/mail-store';
import { resolveReplyFromAddress, sendAndStore } from '$lib/server/outbox';
import { parseRecipients } from '$lib/server/send-mail';

type ForwardBody = {
	fromAddressId?: string;
	to?: string;
	cc?: string;
	bcc?: string;
	/** What the sender adds above the forwarded message. */
	text?: string;
	html?: string;
	/** Carry the original's files along; on by default. */
	includeAttachments?: boolean;
};

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

	const body = (await request.json()) as ForwardBody;
	if (parseRecipients(body.to).length === 0) {
		return json({ error: 'A recipient is required' }, { status: 400 });
	}

	const { subject, text, html } = buildForwardedMessage(original, {
		note: { text: body.text, html: body.html }
	});

	// Same identity rule as a reply: the mailbox the message arrived at, unless
	// the sender picked another one.
	const fromAddress = body.fromAddressId
		? undefined
		: await resolveReplyFromAddress(db, locals.user, original);

	// A forward goes to someone outside the original exchange, so it starts its
	// own conversation rather than continuing that one — no In-Reply-To chain.
	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore({ DB: db, ATTACHMENTS: bucket }, provider, locals.user, {
			fromAddressId: body.fromAddressId,
			fromAddress,
			to: body.to!,
			cc: body.cc,
			bcc: body.bcc,
			subject,
			text,
			html,
			subjectMatch: false,
			attachments:
				body.includeAttachments === false
					? []
					: await readOutboundAttachments(db, bucket, locals.user.id, original.id)
		});

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to forward message') },
			{ status: statusForProviderError(error) }
		);
	}
};
