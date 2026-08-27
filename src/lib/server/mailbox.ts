import { listMailbox } from './mail-store';
import type { MailboxFilters, MailboxPage, MailboxView } from '$lib/types';
import type { D1Database } from '@cloudflare/workers-types';

export function readFilters(url: URL): MailboxFilters {
	return {
		q: url.searchParams.get('q')?.trim() ?? '',
		unreadOnly: url.searchParams.get('unread') === '1',
		starredOnly: url.searchParams.get('starred') === '1',
		attachmentsOnly: url.searchParams.get('attachments') === '1',
		addressId: url.searchParams.get('address')?.trim() ?? ''
	};
}

const EMPTY: MailboxPage = { threads: [], total: 0, page: 1, pageCount: 1, pageSize: 25 };

/** Shared by every mailbox route — same query shape, different view. */
export async function loadMailbox(
	db: D1Database | undefined,
	userId: string | undefined,
	view: MailboxView,
	url: URL,
	domainId: string | null
): Promise<{ view: MailboxView; mailbox: MailboxPage; filters: MailboxFilters }> {
	const filters = readFilters(url);

	if (!db || !userId) {
		return { view, mailbox: EMPTY, filters };
	}

	const mailbox = await listMailbox(db, userId, {
		view,
		domainId,
		addressId: filters.addressId || null,
		q: filters.q,
		unreadOnly: filters.unreadOnly,
		starredOnly: filters.starredOnly,
		attachmentsOnly: filters.attachmentsOnly,
		page: Number(url.searchParams.get('page')) || 1
	});

	return { view, mailbox, filters };
}
