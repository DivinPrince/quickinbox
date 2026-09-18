import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { MAILBOX_PAGE_SIZE } from '$lib/constants';
import { MAX_BODY_BYTES } from './constants';
import { stripQuotedText } from '$lib/utils/quotes';
import { displaySubject, normalizeSubject, resolveThreadId } from './threads';
import { buildThreadParticipants } from './thread-participants';
import { emptyMailboxCounts, parseInboxCategory } from '$lib/mail/categories';
import { labelsForEmails } from './labels';
import type {
	ClassificationSource,
	DeliveryStatus,
	EmailAttachmentMeta,
	EmailRow,
	EmailSummary,
	InboxCategory,
	MailboxCounts,
	MailboxPage,
	MailboxView,
	MailStatus,
	ThreadLabel,
	ThreadMessage,
	ThreadSummary
} from '$lib/types';

import { chunkIds } from './d1';

export async function getUserIdByEmail(db: D1Database, email: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT id FROM users WHERE email = ?')
		.bind(email.toLowerCase())
		.first<{ id: string }>();

	return row?.id ?? null;
}

export async function insertEmail(
	db: D1Database,
	input: {
		userId: string;
		direction: 'inbound' | 'outbound';
		from: string;
		fromName?: string | null;
		to: string;
		cc?: string | null;
		bcc?: string | null;
		subject: string;
		bodyText?: string | null;
		bodyHtml?: string | null;
		messageId?: string | null;
		inReplyTo?: string | null;
		references?: string | null;
		replyToEmailId?: string | null;
		domainId?: string | null;
		addressId?: string | null;
		providerId?: string | null;
		status?: MailStatus | null;
		isRead?: boolean;
		/** Disable fallback grouping when this message must start a conversation. */
		subjectMatch?: boolean;
	}
): Promise<string> {
	const id = crypto.randomUUID();
	const bodyText = truncate(input.bodyText ?? null);
	const bodyHtml = truncate(input.bodyHtml ?? null);

	// Every message lands in a conversation before it is stored, so the list
	// view never has to guess.
	const threadId = await resolveThreadId(db, input.userId, {
		emailId: id,
		direction: input.direction,
		subject: input.subject,
		from: input.from,
		to: input.to,
		cc: input.cc,
		inReplyTo: input.inReplyTo,
		references: input.references,
		replyToEmailId: input.replyToEmailId,
		domainId: input.domainId,
		subjectMatch: input.subjectMatch ?? input.status !== 'draft'
	});

	await db
		.prepare(
			`INSERT INTO emails (
				id, user_id, direction, from_addr, from_name, to_addr, cc_addr, bcc_addr, subject,
				body_text, body_html, message_id, in_reply_to, references_header,
				reply_to_email_id, thread_id, thread_key,
				domain_id, address_id, provider_id, status, status_at, is_read
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
		)
		.bind(
			id,
			input.userId,
			input.direction,
			input.from,
			input.fromName?.trim() || null,
			input.to,
			input.cc ?? null,
			input.bcc ?? null,
			input.subject,
			bodyText,
			bodyHtml,
			input.messageId ?? null,
			input.inReplyTo ?? null,
			input.references ?? null,
			input.replyToEmailId ?? null,
			threadId,
			normalizeSubject(input.subject),
			input.domainId ?? null,
			input.addressId ?? null,
			input.providerId ?? null,
			input.status ?? null,
			input.isRead ? 1 : 0
		)
		.run();

	// A new inbound reply brings an archived conversation back to the inbox.
	// Clear the thread-wide archive state after the message is safely stored.
	if (input.direction === 'inbound') {
		await db
			.prepare(
				`UPDATE emails SET archived_at = NULL, updated_at = datetime('now')
				 WHERE user_id = ? AND COALESCE(thread_id, id) = ?`
			)
			.bind(input.userId, threadId)
			.run();
	} else if (input.replyToEmailId) {
		// Sending a reply from an archived conversation should not silently move
		// it back into the inbox. Carry the parent's archive state to the new row.
		await db
			.prepare(
				`UPDATE emails SET archived_at = datetime('now')
				 WHERE id = ? AND user_id = ?
				   AND EXISTS (
				     SELECT 1 FROM emails parent
				     WHERE parent.id = ? AND parent.user_id = ? AND parent.archived_at IS NOT NULL
				   )`
			)
			.bind(id, input.userId, input.replyToEmailId, input.userId)
			.run();
	}

	return id;
}

/**
 * The id a thread is addressed by in the UI (`/inbox?thread=…`). A message that
 * starts a conversation has no `thread_id` of its own and stands in for it.
 */
export async function getThreadKey(db: D1Database, emailId: string): Promise<string> {
	const row = await db
		.prepare('SELECT COALESCE(thread_id, id) AS thread_key FROM emails WHERE id = ?')
		.bind(emailId)
		.first<{ thread_key: string }>();

	return row?.thread_key ?? emailId;
}

/** Already stored? Resend retries webhooks, so inbound writes must be idempotent. */
export async function emailExistsByProviderId(
	db: D1Database,
	providerId: string
): Promise<boolean> {
	const row = await db
		.prepare('SELECT id FROM emails WHERE provider_id = ?')
		.bind(providerId)
		.first<{ id: string }>();
	return Boolean(row);
}

/** Applied when Resend reports delivery/bounce/complaint on something we sent. */
export async function updateEmailStatusByProviderId(
	db: D1Database,
	providerId: string,
	status: DeliveryStatus,
	detail?: string | null
): Promise<void> {
	await db
		.prepare(
			`UPDATE emails SET status = ?, status_at = datetime('now'), status_detail = ?
			 WHERE provider_id = ?`
		)
		.bind(status, detail ?? null, providerId)
		.run();
}

/**
 * Every mailbox is a slice of the same table: Drafts are unsent outbound rows,
 * Trash is anything with `deleted_at`, and the rest hide trashed mail. A
 * conversation shows up in a mailbox when any of its messages match.
 */
function viewFilter(view: MailboxView): string {
	switch (view) {
		case 'inbox':
			return "e.deleted_at IS NULL AND e.archived_at IS NULL AND e.spam_at IS NULL AND e.direction = 'inbound'";
		case 'archive':
			return "e.deleted_at IS NULL AND e.spam_at IS NULL AND e.archived_at IS NOT NULL AND (e.status IS NULL OR e.status <> 'draft')";
		case 'sent':
			return "e.deleted_at IS NULL AND e.spam_at IS NULL AND e.direction = 'outbound' AND (e.status IS NULL OR e.status <> 'draft')";
		case 'drafts':
			return "e.deleted_at IS NULL AND e.spam_at IS NULL AND e.status = 'draft'";
		case 'starred':
			return "e.deleted_at IS NULL AND e.spam_at IS NULL AND e.is_starred = 1 AND (e.status IS NULL OR e.status <> 'draft')";
		case 'trash':
			return 'e.deleted_at IS NOT NULL';
		case 'spam':
			return 'e.deleted_at IS NULL AND e.spam_at IS NOT NULL';
		default: {
			const _never: never = view;
			return _never;
		}
	}
}

/**
 * Which messages of a matched conversation are actually rendered. Wider than
 * `viewFilter` on purpose — an inbox row counts the replies we sent too, so it
 * reads as one conversation rather than a matched message.
 */
function displayFilter(view: MailboxView, alias: string): string {
	switch (view) {
		case 'trash':
			return `${alias}.deleted_at IS NOT NULL`;
		case 'drafts':
			return `${alias}.deleted_at IS NULL AND ${alias}.status = 'draft'`;
		default:
			return `${alias}.deleted_at IS NULL AND (${alias}.status IS NULL OR ${alias}.status <> 'draft')`;
	}
}

export type MailboxQuery = {
	view: MailboxView;
	/** Restrict to one connected domain; omit for the combined view. */
	domainId?: string | null;
	/** Restrict to one registered address, for users with several mailboxes. */
	addressId?: string | null;
	/** Free text matched against participants, subject and body. */
	q?: string | null;
	unreadOnly?: boolean;
	starredOnly?: boolean;
	attachmentsOnly?: boolean;
	page?: number;
	pageSize?: number;
	/** Inbox tab. Null means every category (used for unscoped search). */
	category?: InboxCategory | null;
	/** Custom label; ignores inbox category and includes archived mail. */
	labelId?: string | null;
};

type ThreadMessageRow = {
	id: string;
	thread_id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	subject: string;
	body_head: string | null;
	is_read: number;
	is_starred: number;
	archived_at: string | null;
	spam_at: string | null;
	category: string | null;
	has_attachments: number;
	domain_id: string | null;
	address_id: string | null;
	status: MailStatus | null;
	created_at: string;
};

/** Builds the WHERE clause and bindings shared by the count and the page query. */
function buildScope(userId: string, query: MailboxQuery): { where: string; bindings: unknown[] } {
	const filters = ['e.user_id = ?'];
	const bindings: unknown[] = [userId];

	if (query.labelId) {
		filters.push(
			`e.deleted_at IS NULL AND e.spam_at IS NULL
			 AND EXISTS (SELECT 1 FROM email_labels el WHERE el.email_id = e.id AND el.label_id = ?)`
		);
		bindings.push(query.labelId);
	} else {
		filters.push(viewFilter(query.view));
		if (query.view === 'inbox' && query.category) {
			filters.push('e.category = ?');
			bindings.push(query.category);
		}
	}

	if (query.domainId) {
		filters.push('e.domain_id = ?');
		bindings.push(query.domainId);
	}

	if (query.addressId) {
		filters.push('e.address_id = ?');
		bindings.push(query.addressId);
	}

	const term = query.q?.trim();
	if (term) {
		filters.push(
			`(e.subject LIKE ? ESCAPE '\\' OR e.from_addr LIKE ? ESCAPE '\\'
			  OR e.to_addr LIKE ? ESCAPE '\\' OR e.body_text LIKE ? ESCAPE '\\')`
		);
		const like = `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
		bindings.push(like, like, like, like);
	}

	if (query.unreadOnly) filters.push('e.is_read = 0');
	if (query.starredOnly) filters.push('e.is_starred = 1');
	if (query.attachmentsOnly) {
		filters.push('EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)');
	}

	return { where: filters.join(' AND '), bindings };
}

/**
 * One page of conversations. Filters match individual messages, but the unit of
 * the list is the thread they belong to, ordered by its most recent message.
 */
export async function listMailbox(
	db: D1Database,
	userId: string,
	query: MailboxQuery
): Promise<MailboxPage> {
	const { where, bindings } = buildScope(userId, query);
	const pageSize = query.pageSize ?? MAILBOX_PAGE_SIZE;
	const display = displayFilter(query.view, 'm');

	const totalRow = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM (
				SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
			)`
		)
		.bind(...bindings)
		.first<{ count: number }>();

	const total = totalRow?.count ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(1, query.page ?? 1), pageCount);

	if (total === 0) {
		return { threads: [], total, page, pageCount, pageSize };
	}

	const { results: rows } = await db
		.prepare(
			`SELECT t.thread_id, MAX(datetime(m.created_at)) AS last_at
			 FROM (
				SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
			 ) t
			 JOIN emails m
			   ON m.user_id = ? AND COALESCE(m.thread_id, m.id) = t.thread_id AND ${display}
			 GROUP BY t.thread_id
			 ORDER BY last_at DESC
			 LIMIT ? OFFSET ?`
		)
		.bind(...bindings, userId, pageSize, (page - 1) * pageSize)
		.all<{ thread_id: string; last_at: string }>();

	const threadIds = rows.map((row) => row.thread_id);
	if (threadIds.length === 0) {
		return { threads: [], total, page, pageCount, pageSize };
	}

	const placeholders = threadIds.map(() => '?').join(', ');
	const { results: messages } = await db
		.prepare(
			`SELECT m.id, COALESCE(m.thread_id, m.id) AS thread_id, m.direction, m.from_addr, m.from_name, m.to_addr,
			        m.subject, m.is_read, m.is_starred, m.archived_at, m.spam_at, m.category, m.created_at, m.domain_id, m.address_id, m.status,
			        substr(COALESCE(m.body_text, ''), 1, 4000) AS body_head,
			        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = m.id) AS has_attachments
			 FROM emails m
			 WHERE m.user_id = ? AND COALESCE(m.thread_id, m.id) IN (${placeholders}) AND ${display}
			 ORDER BY datetime(m.created_at) ASC`
		)
		.bind(userId, ...threadIds)
		.all<ThreadMessageRow>();

	const byThread = new Map<string, ThreadMessageRow[]>();
	for (const message of messages) {
		const bucket = byThread.get(message.thread_id);
		if (bucket) bucket.push(message);
		else byThread.set(message.thread_id, [message]);
	}

	const labelsByEmail = await labelsForEmails(
		db,
		messages.map((message) => message.id)
	);

	const threads = threadIds
		.map((threadId) => byThread.get(threadId))
		.filter((group): group is ThreadMessageRow[] => Boolean(group?.length))
		.map((group) => toThreadSummary(group, labelsByEmail));

	return { threads, total, page, pageCount, pageSize };
}

/** `messages` is the whole conversation, oldest first. */
function toThreadSummary(
	messages: ThreadMessageRow[],
	labelsByEmail: Map<string, ThreadLabel[]> = new Map()
): ThreadSummary {
	const oldest = messages[0];
	const latest = messages[messages.length - 1];
	const participants = buildThreadParticipants(messages);
	const latestInbound = [...messages].reverse().find((message) => message.direction === 'inbound');
	const labels: ThreadLabel[] = [];
	for (const message of messages) {
		for (const label of labelsByEmail.get(message.id) ?? []) {
			if (!labels.some((entry) => entry.id === label.id)) labels.push(label);
		}
	}

	return {
		thread_id: oldest.thread_id,
		latest_id: latest.id,
		// The conversation keeps the subject it started with, not "Re: Re: …".
		subject: displaySubject(oldest.subject),
		preview: buildPreview(latest.body_head),
		participants,
		message_count: messages.length,
		is_read: messages.every((message) => message.is_read === 1),
		is_starred: messages.some((message) => message.is_starred === 1),
		is_draft: latest.status === 'draft',
		is_archived: messages.every((message) => message.archived_at !== null),
		is_spam: messages.some((message) => message.spam_at !== null),
		has_attachments: messages.some((message) => message.has_attachments === 1),
		domain_id: latest.domain_id,
		address_id: latest.address_id,
		status: latest.status === 'draft' ? null : latest.status,
		category: parseInboxCategory(latestInbound?.category ?? latest.category),
		labels,
		created_at: latest.created_at
	};
}

/** The newest message's own words — quoted history is dropped. */
function buildPreview(bodyHead: string | null): string {
	if (!bodyHead) return '';
	return stripQuotedText(bodyHead).replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** Flat message list, used by the JSON API rather than the mailbox UI. */
export async function listEmails(
	db: D1Database,
	userId: string,
	options: {
		direction?: 'inbound' | 'outbound';
		domainId?: string | null;
		limit?: number;
	} = {}
): Promise<EmailSummary[]> {
	const view: MailboxView = options.direction === 'outbound' ? 'sent' : 'inbox';
	const { where, bindings } = buildScope(userId, { view, domainId: options.domainId });

	const { results } = await db
		.prepare(
				`SELECT e.id, e.direction, e.from_addr, e.to_addr, e.subject, e.is_read, e.is_starred, e.archived_at,
				        e.spam_at, e.created_at, e.domain_id, e.address_id, e.status,
			        substr(COALESCE(e.body_text, ''), 1, 4000) AS body_head,
			        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id) AS has_attachments
			 FROM emails e
			 WHERE ${where}
			 ORDER BY datetime(e.created_at) DESC
			 LIMIT ?`
		)
		.bind(...bindings, options.limit ?? 100)
		.all<ThreadMessageRow>();

	return results.map((row) => ({
		id: row.id,
		direction: row.direction,
		from_addr: row.from_addr,
		to_addr: row.to_addr,
		subject: row.subject,
		preview: buildPreview(row.body_head),
		is_read: row.is_read === 1,
		is_starred: row.is_starred === 1,
		is_draft: row.status === 'draft',
		is_archived: row.archived_at !== null,
		is_spam: row.spam_at !== null,
		has_attachments: row.has_attachments === 1,
		domain_id: row.domain_id,
		address_id: row.address_id,
		status: row.status === 'draft' ? null : row.status,
		created_at: row.created_at
	}));
}

/**
 * Cheap "has anything been inserted or deleted?" fingerprint. Flag changes
 * (read, star, archive) do not move this, so a live poll can refresh on new
 * mail without fighting the user's current selection.
 */
export function encodeMailboxCursor(
	messageCount: number,
	latestRowid: number,
	epoch = 0
): string {
	if (!epoch) return `${messageCount}:${latestRowid}`;
	return `${messageCount}:${latestRowid}:${epoch}`;
}

export async function getMailboxCursor(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<string> {
	const bindings: unknown[] = [userId];
	let scope = 'user_id = ?';
	if (domainId) {
		scope += ' AND domain_id = ?';
		bindings.push(domainId);
	}

	const [row, epochRow] = await Promise.all([
		db
			.prepare(
				`SELECT COUNT(*) AS message_count, COALESCE(MAX(rowid), 0) AS latest_rowid
				 FROM emails WHERE ${scope}`
			)
			.bind(...bindings)
			.first<{ message_count: number | string | null; latest_rowid: number | string | null }>(),
		db
			.prepare('SELECT COALESCE(mailbox_epoch, 0) AS mailbox_epoch FROM users WHERE id = ?')
			.bind(userId)
			.first<{ mailbox_epoch: number | string | null }>()
	]);

	return encodeMailboxCursor(
		Number(row?.message_count ?? 0),
		Number(row?.latest_rowid ?? 0),
		Number(epochRow?.mailbox_epoch ?? 0)
	);
}

export async function bumpMailboxEpoch(db: D1Database, userId: string): Promise<void> {
	await db
		.prepare('UPDATE users SET mailbox_epoch = COALESCE(mailbox_epoch, 0) + 1 WHERE id = ?')
		.bind(userId)
		.run();
}

/**
 * Row counts behind every sidebar entry, in one round trip. Counted in
 * conversations so the badges agree with what the lists actually show.
 */
export async function getMailboxCounts(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<MailboxCounts> {
	const bindings: unknown[] = [userId];
	let scope = 'user_id = ?';
	if (domainId) {
		scope += ' AND domain_id = ?';
		bindings.push(domainId);
	}

	const thread = 'COALESCE(thread_id, id)';

	const inboxOpen =
		"deleted_at IS NULL AND archived_at IS NULL AND spam_at IS NULL AND direction = 'inbound'";
	const byCategory = (category: InboxCategory, unread = false) =>
		`COUNT(DISTINCT CASE WHEN ${inboxOpen} AND category = '${category}'${unread ? ' AND is_read = 0' : ''} THEN ${thread} END)`;

	const row = await db
		.prepare(
			`SELECT
				COUNT(DISTINCT CASE WHEN ${inboxOpen} THEN ${thread} END) AS inbox,
				COUNT(DISTINCT CASE WHEN ${inboxOpen} AND is_read = 0 THEN ${thread} END) AS inbox_unread,
				${byCategory('primary')} AS primary_count,
				${byCategory('primary', true)} AS primary_unread,
				${byCategory('social')} AS social,
				${byCategory('social', true)} AS social_unread,
				${byCategory('promotions')} AS promotions,
				${byCategory('promotions', true)} AS promotions_unread,
				${byCategory('updates')} AS updates,
				${byCategory('updates', true)} AS updates_unread,
				${byCategory('forums')} AS forums,
				${byCategory('forums', true)} AS forums_unread,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND spam_at IS NULL AND archived_at IS NOT NULL AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS archive,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND spam_at IS NULL AND is_starred = 1 AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS starred,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND spam_at IS NULL AND status = 'draft' THEN ${thread} END) AS drafts,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND spam_at IS NULL AND direction = 'outbound' AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS sent,
				COUNT(DISTINCT CASE WHEN deleted_at IS NOT NULL THEN ${thread} END) AS trash,
				COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND spam_at IS NOT NULL THEN ${thread} END) AS spam
			 FROM emails WHERE ${scope}`
		)
		.bind(...bindings)
		.first<{
			inbox: number | null;
			inbox_unread: number | null;
			primary_count: number | null;
			primary_unread: number | null;
			social: number | null;
			social_unread: number | null;
			promotions: number | null;
			promotions_unread: number | null;
			updates: number | null;
			updates_unread: number | null;
			forums: number | null;
			forums_unread: number | null;
			archive: number | null;
			starred: number | null;
			drafts: number | null;
			sent: number | null;
			trash: number | null;
			spam: number | null;
		}>();

	const counts = emptyMailboxCounts();
	if (!row) return counts;
	counts.inbox = row.inbox ?? 0;
	counts.inbox_unread = row.inbox_unread ?? 0;
	counts.primary = row.primary_count ?? 0;
	counts.primary_unread = row.primary_unread ?? 0;
	counts.social = row.social ?? 0;
	counts.social_unread = row.social_unread ?? 0;
	counts.promotions = row.promotions ?? 0;
	counts.promotions_unread = row.promotions_unread ?? 0;
	counts.updates = row.updates ?? 0;
	counts.updates_unread = row.updates_unread ?? 0;
	counts.forums = row.forums ?? 0;
	counts.forums_unread = row.forums_unread ?? 0;
	counts.archive = row.archive ?? 0;
	counts.starred = row.starred ?? 0;
	counts.drafts = row.drafts ?? 0;
	counts.sent = row.sent ?? 0;
	counts.trash = row.trash ?? 0;
	counts.spam = row.spam ?? 0;
	return counts;
}

export async function countUnread(
	db: D1Database,
	userId: string,
	domainId?: string | null
): Promise<number> {
	const counts = await getMailboxCounts(db, userId, domainId);
	return counts.inbox_unread;
}

/**
 * Widens a set of message ids to every message in the same conversations.
 * List actions read as conversation actions — trashing a thread trashes the
 * replies with it.
 */
export async function expandToThreads(
	db: D1Database,
	userId: string,
	ids: string[]
): Promise<string[]> {
	if (ids.length === 0) return [];

	const found = new Set<string>();
	for (const group of chunkIds(ids)) {
		const placeholders = group.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				`SELECT id FROM emails
				 WHERE user_id = ?
				 AND COALESCE(thread_id, id) IN (
					SELECT COALESCE(thread_id, id) FROM emails WHERE user_id = ? AND id IN (${placeholders})
				 )`
			)
			.bind(userId, userId, ...group)
			.all<{ id: string }>();
		for (const row of results) found.add(row.id);
	}

	return [...found];
}

export type MailFlagUpdate = {
	isRead?: boolean;
	isStarred?: boolean;
	archived?: boolean;
	trashed?: boolean;
	spam?: boolean;
	spamSource?: ClassificationSource;
	category?: InboxCategory;
	categorySource?: ClassificationSource | null;
};

/** Applies list actions (read/unread, star, archive, trash, restore, spam, category) to a set of rows. */
export async function setEmailFlags(
	db: D1Database,
	userId: string,
	ids: string[],
	update: MailFlagUpdate
): Promise<number> {
	if (ids.length === 0) return 0;

	const assignments: string[] = [];
	const bindings: unknown[] = [];
	let bumpEpoch = false;

	if (update.isRead !== undefined) {
		assignments.push('is_read = ?');
		bindings.push(update.isRead ? 1 : 0);
	}
	if (update.isStarred !== undefined) {
		assignments.push('is_starred = ?');
		bindings.push(update.isStarred ? 1 : 0);
	}
	if (update.archived !== undefined) {
		assignments.push(update.archived ? "archived_at = datetime('now')" : 'archived_at = NULL');
	}
	if (update.trashed !== undefined) {
		assignments.push(update.trashed ? "deleted_at = datetime('now')" : 'deleted_at = NULL');
	}
	if (update.spam !== undefined) {
		if (update.spam) {
			assignments.push("spam_at = datetime('now')", 'archived_at = NULL', 'spam_source = ?');
			bindings.push(update.spamSource ?? 'user');
		} else {
			assignments.push('spam_at = NULL', 'spam_source = NULL');
		}
		bumpEpoch = true;
	}
	if (update.category !== undefined) {
		assignments.push('category = ?', 'category_source = ?');
		bindings.push(update.category, update.categorySource ?? 'user');
		bumpEpoch = true;
	}

	if (assignments.length === 0) return 0;
	if (bumpEpoch) assignments.push("updated_at = datetime('now')");

	let changes = 0;
	for (const group of chunkIds(ids)) {
		const placeholders = group.map(() => '?').join(', ');
		const result = await db
			.prepare(
				`UPDATE emails SET ${assignments.join(', ')}
				 WHERE user_id = ? AND id IN (${placeholders})`
			)
			.bind(...bindings, userId, ...group)
			.run();
		changes += result.meta?.changes ?? 0;
	}

	if (bumpEpoch) await bumpMailboxEpoch(db, userId);

	return changes;
}

/** Irreversible: drops the rows and the R2 objects their attachments point at. */
export async function deleteEmailsPermanently(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string,
	ids: string[]
): Promise<number> {
	if (ids.length === 0) return 0;

	let deletedCount = 0;
	for (const group of chunkIds([...new Set(ids)])) {
		const placeholders = group.map(() => '?').join(', ');
		const owned = await db
			.prepare(`SELECT id FROM emails WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(userId, ...group)
			.all<{ id: string }>();

		const ownedIds = owned.results.map((row) => row.id);
		if (ownedIds.length === 0) continue;

		deletedCount += ownedIds.length;
		const ownedPlaceholders = ownedIds.map(() => '?').join(', ');

		if (bucket) {
			const { results: files } = await db
				.prepare(
					`SELECT storage_key FROM email_attachments
					 WHERE email_id IN (${ownedPlaceholders}) AND storage_key IS NOT NULL`
				)
				.bind(...ownedIds)
				.all<{ storage_key: string }>();

			await Promise.all(files.map((file) => bucket.delete(file.storage_key)));
		}

		// Older D1 databases were created without ON DELETE CASCADE enforcement,
		// so clear the children explicitly.
		await db
			.prepare(`DELETE FROM email_attachments WHERE email_id IN (${ownedPlaceholders})`)
			.bind(...ownedIds)
			.run();

		await db
			.prepare(`DELETE FROM email_labels WHERE email_id IN (${ownedPlaceholders})`)
			.bind(...ownedIds)
			.run();

		await db
			.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${ownedPlaceholders})`)
			.bind(userId, ...ownedIds)
			.run();
	}

	return deletedCount;
}

/** "Mark all as read" from the list menu — scoped to the active domain filter. */
export async function markAllRead(
	db: D1Database,
	userId: string,
	domainId?: string | null,
	category?: InboxCategory | null,
	labelId?: string | null
): Promise<number> {
	const bindings: unknown[] = [userId];
	let scope = labelId
		? "user_id = ? AND deleted_at IS NULL AND spam_at IS NULL AND is_read = 0 AND EXISTS (SELECT 1 FROM email_labels el WHERE el.email_id = emails.id AND el.label_id = ?)"
		: "user_id = ? AND direction = 'inbound' AND deleted_at IS NULL AND archived_at IS NULL AND spam_at IS NULL AND is_read = 0";
	if (labelId) {
		bindings.push(labelId);
	}
	if (domainId) {
		scope += ' AND domain_id = ?';
		bindings.push(domainId);
	}
	if (!labelId && category) {
		scope += ' AND category = ?';
		bindings.push(category);
	}

	const result = await db
		.prepare(`UPDATE emails SET is_read = 1 WHERE ${scope}`)
		.bind(...bindings)
		.run();

	return result.meta?.changes ?? 0;
}

export async function emptySpam(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string
): Promise<number> {
	const { results } = await db
		.prepare('SELECT id FROM emails WHERE user_id = ? AND spam_at IS NOT NULL AND deleted_at IS NULL')
		.bind(userId)
		.all<{ id: string }>();

	return deleteEmailsPermanently(
		db,
		bucket,
		userId,
		results.map((row) => row.id)
	);
}

export async function getThreadUserCategory(
	db: D1Database,
	userId: string,
	threadId: string
): Promise<InboxCategory | null> {
	const row = await db
		.prepare(
			`SELECT category FROM emails
			 WHERE user_id = ? AND COALESCE(thread_id, id) = ? AND category_source = 'user'
			 LIMIT 1`
		)
		.bind(userId, threadId)
		.first<{ category: string }>();

	return row ? parseInboxCategory(row.category) : null;
}

/** One round trip for a classify window — per-thread lookups overflow Miniflare/D1. */
export async function listThreadUserCategories(
	db: D1Database,
	userId: string
): Promise<Map<string, InboxCategory>> {
	const { results } = await db
		.prepare(
			`SELECT COALESCE(thread_id, id) AS thread_id, category
			 FROM emails
			 WHERE user_id = ? AND category_source = 'user'`
		)
		.bind(userId)
		.all<{ thread_id: string; category: string }>();

	const locked = new Map<string, InboxCategory>();
	for (const row of results) {
		if (!row.thread_id) continue;
		locked.set(row.thread_id, parseInboxCategory(row.category));
	}
	return locked;
}

export async function emptyTrash(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string
): Promise<number> {
	const { results } = await db
		.prepare('SELECT id FROM emails WHERE user_id = ? AND deleted_at IS NOT NULL')
		.bind(userId)
		.all<{ id: string }>();

	return deleteEmailsPermanently(
		db,
		bucket,
		userId,
		results.map((row) => row.id)
	);
}

export type DraftInput = {
	id?: string | null;
	from: string;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	bodyText?: string | null;
	bodyHtml?: string | null;
	domainId?: string | null;
	addressId?: string | null;
};

/** Creates or updates a draft; drafts are outbound rows Resend never saw. */
export async function saveDraft(
	db: D1Database,
	userId: string,
	input: DraftInput
): Promise<string> {
	if (input.id) {
		const existing = await db
			.prepare("SELECT id FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
			.bind(input.id, userId)
			.first<{ id: string }>();

		if (existing) {
			await db
				.prepare(
					`UPDATE emails SET from_addr = ?, to_addr = ?, cc_addr = ?, bcc_addr = ?,
					        subject = ?, thread_key = ?, body_text = ?, body_html = ?,
					        domain_id = ?, address_id = ?,
					        created_at = datetime('now'), deleted_at = NULL
					 WHERE id = ? AND user_id = ?`
				)
				.bind(
					input.from,
					input.to,
					input.cc ?? null,
					input.bcc ?? null,
					input.subject,
					normalizeSubject(input.subject),
					input.bodyText ?? null,
					input.bodyHtml ?? null,
					input.domainId ?? null,
					input.addressId ?? null,
					input.id,
					userId
				)
				.run();

			return input.id;
		}
	}

	return insertEmail(db, {
		userId,
		direction: 'outbound',
		from: input.from,
		to: input.to,
		cc: input.cc ?? null,
		bcc: input.bcc ?? null,
		subject: input.subject,
		bodyText: input.bodyText ?? null,
		bodyHtml: input.bodyHtml ?? null,
		domainId: input.domainId ?? null,
		addressId: input.addressId ?? null,
		status: 'draft',
		isRead: true
	});
}

export async function getDraft(
	db: D1Database,
	userId: string,
	draftId: string
): Promise<EmailRow | null> {
	const row = await db
		.prepare("SELECT * FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
		.bind(draftId, userId)
		.first<EmailRow>();

	return row ?? null;
}

export async function deleteDraft(db: D1Database, userId: string, draftId: string): Promise<void> {
	await db
		.prepare("DELETE FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
		.bind(draftId, userId)
		.run();
}

export async function getEmailForUser(
	db: D1Database,
	userId: string,
	emailId: string
): Promise<EmailRow | null> {
	const row = await db
		.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
		.bind(emailId, userId)
		.first<EmailRow>();

	return row ?? null;
}

/**
 * Resolve a forwarding target entirely on the server. The client supplies only
 * the conversation id; ownership and membership are enforced by this query,
 * and the order is the order used in the forwarded copy.
 */
export async function listForwardThreadMessages(
	db: D1Database,
	userId: string,
	threadId: string
): Promise<EmailRow[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM emails
			 WHERE user_id = ?
			   AND COALESCE(thread_id, id) = ?
			   AND (status IS NULL OR status <> 'draft')
			   AND deleted_at IS NULL
			 ORDER BY datetime(created_at) ASC, id ASC`
		)
		.bind(userId, threadId)
		.all<EmailRow>();

	return results;
}

/**
 * The whole conversation an email belongs to, oldest first — both directions,
 * which is the point: a reply from the other side is part of the thread, not a
 * new message in the inbox.
 */
export async function listThreadMessages(
	db: D1Database,
	userId: string,
	email: EmailRow
): Promise<ThreadMessage[]> {
	const threadId = email.thread_id ?? email.id;

	// Opening a trashed message shows the trashed conversation; otherwise the
	// live one. Drafts are edited in the composer, never inline.
	const scope = email.deleted_at ? '' : 'AND e.deleted_at IS NULL';

	const { results } = await db
		.prepare(
			`SELECT e.id, e.direction, e.from_addr, e.from_name, e.to_addr, e.cc_addr, e.subject,
			        e.body_text, e.body_html, e.message_id, e.references_header,
			        e.status, e.status_detail, e.is_read, e.is_starred, e.deleted_at,
			        e.archived_at, e.category, e.spam_at, e.created_at
			 FROM emails e
			 WHERE e.user_id = ?
			 AND COALESCE(e.thread_id, e.id) = ?
			 AND (e.status IS NULL OR e.status <> 'draft')
			 ${scope}
			 ORDER BY datetime(e.created_at) ASC`
		)
		.bind(userId, threadId)
		.all<
			Omit<ThreadMessage, 'attachments' | 'is_read' | 'is_starred'> & {
				is_read: number;
				is_starred: number;
			}
		>();

	if (results.length === 0) return [];

	const labelsByEmail = await labelsForEmails(
		db,
		results.map((message) => message.id)
	);

	// Fetch attachments in batches that stay within D1's bound-parameter limit.
	const files: EmailAttachmentMeta[] = [];
	for (const group of chunkIds(results.map((message) => message.id))) {
		const placeholders = group.map(() => '?').join(', ');
		const { results: groupFiles } = await db
			.prepare(
				`SELECT id, email_id, filename, content_type, size_bytes,
				        content_disposition, content_id, created_at
				 FROM email_attachments
				 WHERE email_id IN (${placeholders})
				 ORDER BY created_at ASC`
			)
			.bind(...group)
			.all<EmailAttachmentMeta>();
		files.push(...groupFiles);
	}

	// The query already filters drafts out, so `status` is a delivery state or null
	// and needs no further narrowing here.
	return results.map((message) => ({
		...message,
		category: parseInboxCategory(message.category),
		is_read: message.is_read === 1,
		is_starred: message.is_starred === 1,
		attachments: files.filter((file) => file.email_id === message.id),
		labels: labelsByEmail.get(message.id) ?? []
	}));
}

/** Opening a conversation clears the unread state on all of its messages. */
export async function markThreadRead(
	db: D1Database,
	userId: string,
	email: EmailRow
): Promise<void> {
	await db
		.prepare(
			`UPDATE emails SET is_read = 1
			 WHERE user_id = ? AND COALESCE(thread_id, id) = ? AND deleted_at IS NULL`
		)
		.bind(userId, email.thread_id ?? email.id)
		.run();
}

/** Inbound mail that has never been auto- or user-classified (and is not trashed). */
export const UNCLASSIFIED_INBOUND_WHERE = `direction = 'inbound'
	AND deleted_at IS NULL
	AND category_source IS NULL
	AND spam_source IS NULL
	AND (status IS NULL OR status <> 'draft')`;

export type UnclassifiedCursor = {
	createdAt: string;
	id: string;
};

export async function countUnclassifiedInbound(db: D1Database, userId: string): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM emails
			 WHERE user_id = ? AND ${UNCLASSIFIED_INBOUND_WHERE}`
		)
		.bind(userId)
		.first<{ n: number }>();

	return Number(row?.n ?? 0);
}

export async function listUnclassifiedInbound(
	db: D1Database,
	userId: string,
	options: { after?: UnclassifiedCursor | null; limit: number }
): Promise<EmailRow[]> {
	const clauses = [`user_id = ? AND ${UNCLASSIFIED_INBOUND_WHERE}`];
	const bindings: unknown[] = [userId];

	if (options.after) {
		clauses.push('(created_at > ? OR (created_at = ? AND id > ?))');
		bindings.push(options.after.createdAt, options.after.createdAt, options.after.id);
	}

	const { results } = await db
		.prepare(
			`SELECT * FROM emails
			 WHERE ${clauses.join(' AND ')}
			 ORDER BY created_at ASC, id ASC
			 LIMIT ?`
		)
		.bind(...bindings, options.limit)
		.all<EmailRow>();

	return results;
}

function truncate(value: string | null): string | null {
	if (!value) return null;
	if (value.length <= MAX_BODY_BYTES) return value;
	return value.slice(0, MAX_BODY_BYTES);
}
