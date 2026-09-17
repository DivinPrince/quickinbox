import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeMailAction, isMailAction, type MailAction } from '$lib/server/api-access';
import { isInboxCategory } from '$lib/mail/categories';
import { rememberSenders } from '$lib/server/labels';
import {
	deleteEmailsPermanently,
	emptySpam,
	emptyTrash,
	expandToThreads,
	markAllRead,
	setEmailFlags,
	getMailboxCounts
} from '$lib/server/mail-store';

/** Actions that operate on the whole mailbox rather than a selection. */
const WHOLE_MAILBOX: MailAction[] = ['read-all', 'empty-trash', 'empty-spam'];

type ActionBody = {
	action?: MailAction;
	ids?: string[];
	category?: string;
	labelId?: string;
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
		case 'archive':
			affected = await setEmailFlags(db, locals.user.id, ids, { archived: true });
			break;
		case 'unarchive':
			affected = await setEmailFlags(db, locals.user.id, ids, { archived: false });
			break;
		case 'trash':
			affected = await setEmailFlags(db, locals.user.id, ids, { trashed: true });
			break;
		case 'restore':
			affected = await setEmailFlags(db, locals.user.id, ids, { trashed: false });
			break;
		case 'spam':
			affected = await setEmailFlags(db, locals.user.id, ids, { spam: true, spamSource: 'user' });
			await rememberSenders(db, locals.user.id, ids, 'spam');
			break;
		case 'unspam':
			affected = await setEmailFlags(db, locals.user.id, ids, { spam: false });
			await rememberSenders(db, locals.user.id, ids, 'safe');
			break;
		case 'categorize': {
			if (!isInboxCategory(body.category)) {
				return json({ error: 'Unknown category' }, { status: 400 });
			}
			affected = await setEmailFlags(db, locals.user.id, ids, {
				category: body.category,
				categorySource: 'user'
			});
			break;
		}
		case 'delete':
			affected = await deleteEmailsPermanently(
				db,
				platform?.env.ATTACHMENTS,
				locals.user.id,
				ids
			);
			break;
		case 'read-all':
			affected = await markAllRead(
				db,
				locals.user.id,
				locals.activeDomainId,
				isInboxCategory(body.category) ? body.category : null,
				typeof body.labelId === 'string' && body.labelId ? body.labelId : null
			);
			break;
		case 'empty-trash':
			affected = await emptyTrash(db, platform?.env.ATTACHMENTS, locals.user.id);
			break;
		case 'empty-spam':
			affected = await emptySpam(db, platform?.env.ATTACHMENTS, locals.user.id);
			break;
		default: {
			const _never: never = action;
			return _never;
		}
	}

	const counts = await getMailboxCounts(db, locals.user.id, locals.activeDomainId);

	return json({ ok: true, affected, counts });
};
