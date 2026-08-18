import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { deleteDraft, listEmails } from '$lib/server/mail-store';
import { sendAndStore } from '$lib/server/outbox';
import type { OutboundAttachmentInput } from '$lib/types';

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

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const direction = url.searchParams.get('direction');
	const emails = await listEmails(db, locals.user.id, {
		direction: direction === 'inbound' || direction === 'outbound' ? direction : undefined,
		domainId: locals.activeDomainId
	});

	return json({ emails });
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
