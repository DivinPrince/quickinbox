import { json, type RequestHandler } from '@sveltejs/kit';
import { bumpMailboxEpoch } from '$lib/server/mail-store';
import { deleteLabel, parseLabelWriteBody, updateLabel } from '$lib/server/labels';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const parsed = parseLabelWriteBody(await request.json().catch(() => null), 'update');
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	const label = await updateLabel(db, locals.user.id, params.id!, parsed.fields);
	if (!label) return json({ error: 'Not found' }, { status: 404 });
	await bumpMailboxEpoch(db, locals.user.id);

	return json({ label });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const removed = await deleteLabel(db, locals.user.id, params.id!);
	if (!removed) return json({ error: 'Not found' }, { status: 404 });
	await bumpMailboxEpoch(db, locals.user.id);
	return json({ ok: true });
};
