import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeMailAction, isMailAction, type MailAction } from '$lib/server/api-access';
import {
	deleteEmailsPermanently,
	emptyTrash,
	expandToThreads,
	markAllRead,
	setEmailFlags,
	getMailboxCounts
} from '$lib/server/mail-store';

/** Actions that operate on the whole mailbox rather than a selection. */
const WHOLE_MAILBOX: MailAction[] = ['read-all', 'empty-trash'];

type ActionBody = {
	action?: MailAction;
	ids?: string[];
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as ActionBody;
	const action = body.action;

	if (!isMailAction(action)) {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	if (locals.authMethod === 'api_token') {
		const access = authorizeMailAction({
			action,
			authMethod: 'api_token',
			scopes: locals.apiScopes
		});
		if (!access.ok) {
			return json({ error: access.error }, { status: access.status });
		}
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
		default: {
			const _never: never = action;
			return _never;
		}
	}

	const counts = await getMailboxCounts(db, locals.user.id, locals.activeDomainId);

	return json({ ok: true, affected, counts });
};
