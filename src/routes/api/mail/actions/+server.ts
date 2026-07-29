import { json, type RequestHandler } from '@sveltejs/kit';
import {
	deleteEmailsPermanently,
	emptyTrash,
	expandToThreads,
	markAllRead,
	setEmailFlags,
	getMailboxCounts
} from '$lib/server/mail-store';

/** Bulk actions from the list toolbar. */
const ACTIONS = [
	'read',
	'unread',
	'star',
	'unstar',
	'trash',
	'restore',
	'delete',
	'read-all',
	'empty-trash'
] as const;

/** Actions that operate on the whole mailbox rather than a selection. */
const WHOLE_MAILBOX: Action[] = ['read-all', 'empty-trash'];

type Action = (typeof ACTIONS)[number];

type ActionBody = {
	action?: Action;
	ids?: string[];
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as ActionBody;
	const action = body.action;

	if (!action || !ACTIONS.includes(action)) {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	const selected = (body.ids ?? []).filter((id) => typeof id === 'string' && id.length > 0);
	if (selected.length === 0 && !WHOLE_MAILBOX.includes(action)) {
		return json({ error: 'No messages selected' }, { status: 400 });
	}

	// The list works in conversations, so an action on a row applies to every
	// message in it — trashing a thread takes its replies along.
	const ids = await expandToThreads(db, locals.user.id, selected);

	let affected = 0;

	switch (action) {
		case 'read':
			affected = await setEmailFlags(db, locals.user.id, ids, { isRead: true });
			break;
		case 'unread':
			affected = await setEmailFlags(db, locals.user.id, ids, { isRead: false });
			break;
		case 'star':
			affected = await setEmailFlags(db, locals.user.id, ids, { isStarred: true });
			break;
		case 'unstar':
			affected = await setEmailFlags(db, locals.user.id, ids, { isStarred: false });
			break;
		case 'trash':
			affected = await setEmailFlags(db, locals.user.id, ids, { trashed: true });
			break;
		case 'restore':
			affected = await setEmailFlags(db, locals.user.id, ids, { trashed: false });
			break;
		case 'delete':
			affected = await deleteEmailsPermanently(
				db,
				platform?.env.ATTACHMENTS,
				locals.user.id,
				ids
			);
			break;
		case 'read-all':
			affected = await markAllRead(db, locals.user.id, locals.activeDomainId);
			break;
		case 'empty-trash':
			affected = await emptyTrash(db, platform?.env.ATTACHMENTS, locals.user.id);
			break;
	}

	const counts = await getMailboxCounts(db, locals.user.id, locals.activeDomainId);

	return json({ ok: true, affected, counts });
};
