import type { InboxCategory, MailboxCounts } from '$lib/types';

export const INBOX_CATEGORIES = [
	'primary',
	'social',
	'promotions',
	'updates',
	'forums'
] as const satisfies readonly InboxCategory[];

export const DEFAULT_INBOX_CATEGORY: InboxCategory = 'primary';

const CATEGORY_SET = new Set<string>(INBOX_CATEGORIES);

export function isInboxCategory(value: unknown): value is InboxCategory {
	return typeof value === 'string' && CATEGORY_SET.has(value);
}

export function parseInboxCategory(value: string | null | undefined): InboxCategory {
	return isInboxCategory(value) ? value : DEFAULT_INBOX_CATEGORY;
}

/** SQL category slice for a mailbox list. Search with no tab spans every tab. */
export function mailboxCategoryFilter(input: {
	view: string;
	categoryParam?: string | null;
	labelId?: string | null;
	q?: string | null;
}): InboxCategory | null {
	if (input.view !== 'inbox' || input.labelId) return null;
	if (input.categoryParam) return parseInboxCategory(input.categoryParam);
	if (input.q?.trim()) return null;
	return DEFAULT_INBOX_CATEGORY;
}

/** Categories that should not ping the user after auto-classify. */
export function isQuietCategory(category: InboxCategory): boolean {
	switch (category) {
		case 'promotions':
		case 'social':
			return true;
		case 'primary':
		case 'updates':
		case 'forums':
			return false;
		default: {
			const _never: never = category;
			return _never;
		}
	}
}

export function categoryNavKey(category: InboxCategory): string {
	switch (category) {
		case 'primary':
			return 'nav.primary';
		case 'social':
			return 'nav.social';
		case 'promotions':
			return 'nav.promotions';
		case 'updates':
			return 'nav.updates';
		case 'forums':
			return 'nav.forums';
		default: {
			const _never: never = category;
			return _never;
		}
	}
}

export function inboxCategoryPath(category: InboxCategory): string {
	switch (category) {
		case 'primary':
			return '/inbox';
		case 'social':
			return '/inbox?category=social';
		case 'promotions':
			return '/inbox?category=promotions';
		case 'updates':
			return '/inbox?category=updates';
		case 'forums':
			return '/inbox?category=forums';
		default: {
			const _never: never = category;
			return _never;
		}
	}
}

export function categoryUnread(counts: MailboxCounts, category: InboxCategory): number {
	switch (category) {
		case 'primary':
			return counts.primary_unread;
		case 'social':
			return counts.social_unread;
		case 'promotions':
			return counts.promotions_unread;
		case 'updates':
			return counts.updates_unread;
		case 'forums':
			return counts.forums_unread;
		default: {
			const _never: never = category;
			return _never;
		}
	}
}

export function emptyMailboxCounts(): MailboxCounts {
	return {
		inbox: 0,
		inbox_unread: 0,
		primary: 0,
		primary_unread: 0,
		social: 0,
		social_unread: 0,
		promotions: 0,
		promotions_unread: 0,
		updates: 0,
		updates_unread: 0,
		forums: 0,
		forums_unread: 0,
		archive: 0,
		starred: 0,
		drafts: 0,
		sent: 0,
		trash: 0,
		spam: 0
	};
}
