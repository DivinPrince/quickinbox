import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { deleteDraft, listMailbox } from '$lib/server/mail-store';
import { sendAndStore } from '$lib/server/outbox';
import type { MailboxView, OutboundAttachmentInput } from '$lib/types';

type SendMailBody = {
	/** Set when the composer was editing a draft — it is removed once sent. */
	draftId?: string;
	fromAddressId?: string;
	to?: string;
	cc?: string;
	bcc?: string;
	subject?: string;
	text?: string;
	html?: string;
	attachments?: OutboundAttachmentInput[];
};

function mailboxView(url: URL): MailboxView {
	const view = url.searchParams.get('view');
	switch (view) {
		case 'inbox':
		case 'archive':
		case 'starred':
		case 'drafts':
		case 'sent':
		case 'trash':
			return view;
		default:
			break;
	}

	// PR #9 documented `?direction=` on the flat list; keep that working.
	const direction = url.searchParams.get('direction');
	switch (direction) {
		case 'outbound':
			return 'sent';
		case 'inbound':
			return 'inbox';
		default:
			return 'inbox';
	}
}

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const mailbox = await listMailbox(db, locals.user.id, {
		view: mailboxView(url),
		domainId: locals.activeDomainId,
		addressId: url.searchParams.get('address'),
		q: url.searchParams.get('q'),
		unreadOnly: url.searchParams.get('unread') === '1',
		starredOnly: url.searchParams.get('starred') === '1',
		attachmentsOnly: url.searchParams.get('attachments') === '1',
		page: Number(url.searchParams.get('page')) || 1
	});

	return json(mailbox);
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as SendMailBody;

	if (!body.to?.trim() || !body.subject?.trim() || (!body.text?.trim() && !body.html?.trim())) {
		return json({ error: 'To, subject, and message are required' }, { status: 400 });
	}

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			{
				fromAddressId: body.fromAddressId,
				to: body.to,
				cc: body.cc,
				bcc: body.bcc,
				subject: body.subject,
				text: body.text,
				html: body.html,
				attachments: body.attachments
			}
		);

		if (body.draftId) {
			await deleteDraft(db, locals.user.id, body.draftId);
		}

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json({ error: describeProviderError(error) }, { status: statusForProviderError(error) });
	}
};
