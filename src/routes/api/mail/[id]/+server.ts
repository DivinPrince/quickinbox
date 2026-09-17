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
import { resolveReplyFromAddress, sendAndStore } from '$lib/server/outbox';
import { buildReferences, displaySubject } from '$lib/server/threads';
import { isInboxCategory } from '$lib/mail/categories';
import { rememberSenders } from '$lib/server/labels';
import type { OutboundAttachmentInput } from '$lib/types';

type ReplyBody = {
	fromAddressId?: string;
	to?: string;
	cc?: string;
	bcc?: string;
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
		archived?: boolean;
		trashed?: boolean;
		spam?: boolean;
		category?: string;
		/** Set to limit the change to this one message instead of the thread. */
		messageOnly?: boolean;
	};

	const threadWide = body.archived !== undefined || body.spam !== undefined || body.category !== undefined;
	const ids =
		body.messageOnly && !threadWide
			? [params.id!]
			: await expandToThreads(db, locals.user.id, [params.id!]);

	if (body.category !== undefined && !isInboxCategory(body.category)) {
		return json({ error: 'Unknown category' }, { status: 400 });
	}

	const changed = await setEmailFlags(db, locals.user.id, ids, {
		isRead: body.isRead,
		isStarred: body.isStarred,
		archived: body.archived,
		trashed: body.trashed,
		spam: body.spam,
		spamSource: body.spam === undefined ? undefined : 'user',
		category: isInboxCategory(body.category) ? body.category : undefined,
		categorySource: body.category !== undefined ? 'user' : undefined
	});

	if (changed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	if (body.spam === true) await rememberSenders(db, locals.user.id, ids, 'spam');
	if (body.spam === false) await rememberSenders(db, locals.user.id, ids, 'safe');

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
	const to =
		body.to?.trim() ||
		(original.direction === 'inbound' ? original.from_addr : original.to_addr);
	const cc = body.cc?.trim() || undefined;
	const bcc = body.bcc?.trim() || undefined;

	// Reply from the mailbox that received the original. Catch-all mail uses
	// that exact recipient when the user can send on the domain.
	const fromAddress = body.fromAddressId
		? undefined
		: await resolveReplyFromAddress(db, locals.user, original);

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			{
				fromAddressId: body.fromAddressId,
				fromAddress,
				to,
				cc,
				bcc,
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
