import { json, type RequestHandler } from '@sveltejs/kit';
import { bumpMailboxEpoch, expandToThreads } from '$lib/server/mail-store';
import { setThreadLabels } from '$lib/server/labels';

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as { labelIds?: unknown };
	if (!Array.isArray(body.labelIds) || body.labelIds.some((id) => typeof id !== 'string')) {
		return json({ error: 'labelIds must be an array of ids' }, { status: 400 });
	}

	const ids = await expandToThreads(db, locals.user.id, [params.id!]);
	if (ids.length === 0) return json({ error: 'Not found' }, { status: 404 });

	try {
		await setThreadLabels(db, locals.user.id, ids, body.labelIds);
		await bumpMailboxEpoch(db, locals.user.id);
	} catch {
		return json({ error: 'Unknown label' }, { status: 400 });
	}

	return json({ ok: true });
};
