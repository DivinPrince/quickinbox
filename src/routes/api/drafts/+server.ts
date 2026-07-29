import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveFromAddress } from '$lib/server/outbox';
import { saveDraft } from '$lib/server/mail-store';

type DraftBody = {
	id?: string;
	fromAddressId?: string;
	to?: string;
	cc?: string;
	bcc?: string;
	subject?: string;
	text?: string;
	html?: string;
};

/** Create or update a draft. Drafts never touch Resend. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as DraftBody;

	try {
		const from = await resolveFromAddress(db, locals.user, body.fromAddressId);

		const id = await saveDraft(db, locals.user.id, {
			id: body.id,
			from: from.address,
			to: body.to?.trim() ?? '',
			cc: body.cc?.trim() || null,
			bcc: body.bcc?.trim() || null,
			subject: body.subject?.trim() ?? '',
			bodyText: body.text ?? null,
			bodyHtml: body.html ?? null,
			domainId: from.domain_id
		});

		return json({ ok: true, id });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not save draft' },
			{ status: 400 }
		);
	}
};
