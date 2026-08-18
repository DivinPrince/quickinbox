import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import {
	deleteEmailsPermanently,
	expandToThreads,
	getEmailForUser,
	listThreadMessages,
	markThreadRead,
	setEmailFlags
} from '$lib/server/mail-store';
import { sendAndStore } from '$lib/server/outbox';
import { buildReferences, displaySubject } from '$lib/server/threads';
import type { OutboundAttachmentInput } from '$lib/types';

type ReplyBody = {
	fromAddressId?: string;
	text?: string;
	html?: string;
	attachments?: OutboundAttachmentInput[];
};

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const email = await getEmailForUser(db, locals.user.id, params.id!);
	if (!email) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	await markThreadRead(db, locals.user.id, email);
	const messages = await listThreadMessages(db, locals.user.id, email);

	return json({
		threadId: email.thread_id ?? email.id,
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		messages
	});
};

/** Flag toggles from the list and the reader — applied to the whole thread. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as {
		isRead?: boolean;
		isStarred?: boolean;
		trashed?: boolean;
		/** Set to limit the change to this one message instead of the thread. */
		messageOnly?: boolean;
	};

	const ids = body.messageOnly
		? [params.id!]
		: await expandToThreads(db, locals.user.id, [params.id!]);

	const changed = await setEmailFlags(db, locals.user.id, ids, {
		isRead: body.isRead,
		isStarred: body.isStarred,
		trashed: body.trashed
	});

	if (changed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const ids = await expandToThreads(db, locals.user.id, [params.id!]);
	const removed = await deleteEmailsPermanently(db, platform?.env.ATTACHMENTS, locals.user.id, ids);

	if (removed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

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

	const body = (await request.json()) as ReplyBody;
	if (!body.text?.trim() && !body.html?.trim()) {
		return json({ error: 'Message body is required' }, { status: 400 });
	}

	const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
	// Replying to our own message continues the conversation with its recipient.
	const to = original.direction === 'inbound' ? original.from_addr : original.to_addr;

	// Reply from the address the message was sent to, so threads stay coherent.
	const preferredAddress =
		original.direction === 'inbound'
			? locals.addresses.find(
					(address) => address.address.toLowerCase() === original.to_addr.toLowerCase()
				)
			: locals.addresses.find(
					(address) => address.address.toLowerCase() === original.from_addr.toLowerCase()
				);

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			{
				fromAddressId: body.fromAddressId ?? preferredAddress?.id,
				to,
				subject,
				text: body.text,
				html: body.html,
				inReplyTo: original.message_id,
				// Carry the chain forward so the recipient's client — and ours,
				// when they answer — keeps the conversation together.
				references: buildReferences(original.references_header, original.message_id),
				replyToEmailId: original.id,
				attachments: body.attachments
			}
		);

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to send reply') },
			{ status: statusForProviderError(error) }
		);
	}
};
