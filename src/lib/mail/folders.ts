import type { MailboxView } from '$lib/types';
import { DEFAULT_LOCALE } from '$lib/i18n/locales';
import { translate } from '$lib/i18n/translate';

export const FOLDER_PATH: Record<MailboxView, string> = {
	inbox: '/inbox',
	archive: '/archive',
	starred: '/starred',
	drafts: '/drafts',
	sent: '/sent',
	trash: '/trash'
};

export function folderTitle(view: MailboxView, locale: string = DEFAULT_LOCALE): string {
	switch (view) {
		case 'inbox':
			return translate(locale, 'nav.inbox');
		case 'archive':
			return translate(locale, 'nav.archive');
		case 'starred':
			return translate(locale, 'nav.starred');
		case 'drafts':
			return translate(locale, 'nav.drafts');
		case 'sent':
			return translate(locale, 'nav.sent');
		case 'trash':
			return translate(locale, 'nav.bin');
		default: {
			const _never: never = view;
			return _never;
		}
	}
}

export const FOLDER_TITLE: Record<MailboxView, string> = {
	inbox: 'Inbox',
	archive: 'Archive',
	starred: 'Starred',
	drafts: 'Drafts',
	sent: 'Sent',
	trash: 'Bin'
};

export function viewFromLocation(pathname: string, search: URLSearchParams): MailboxView {
	if (pathname === '/archive' || (pathname === '/inbox' && search.get('view') === 'archive')) {
		return 'archive';
	}
	if (pathname === '/drafts') return 'drafts';
	if (pathname === '/sent') return 'sent';
	if (pathname === '/starred') return 'starred';
	if (pathname === '/trash') return 'trash';
	return 'inbox';
}

export function folderPath(view: MailboxView): string {
	return FOLDER_PATH[view];
}

export function mailboxViewForEmail(email: {
	deleted_at: string | null;
	archived_at: string | null;
	status: string | null;
	direction: 'inbound' | 'outbound';
}): MailboxView {
	if (email.deleted_at) return 'trash';
	if (email.status === 'draft') return 'drafts';
	if (email.archived_at) return 'archive';
	if (email.direction === 'outbound') return 'sent';
	return 'inbox';
}

export function participantName(
	participants: { label: string; address: string; self: boolean }[],
	view: MailboxView,
	locale: string = DEFAULT_LOCALE
): string {
	if (view === 'sent' || view === 'drafts') {
		const others = participants.filter((person) => !person.self);
		if (others.length === 0) return translate(locale, 'common.me');
		return others.map((person) => person.label || person.address).join(', ');
	}
	const first = participants.find((person) => !person.self) ?? participants[0];
	return first?.label || first?.address || translate(locale, 'common.unknown');
}

export function initials(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '?';
	const parts = trimmed.split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export type AddressPart = {
	name: string;
	email: string;
};

/** Split a To/Cc field into display name + address pairs for the Zero thread chrome. */
export function parseAddressList(value: string | null | undefined): AddressPart[] {
	if (!value?.trim()) return [];
	const parts: string[] = [];
	let start = 0;
	let inQuotes = false;
	let brackets = 0;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === '"') inQuotes = !inQuotes;
		if (!inQuotes && character === '<') brackets += 1;
		if (!inQuotes && character === '>' && brackets > 0) brackets -= 1;
		if (!inQuotes && brackets === 0 && character === ',') {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));

	const seen = new Set<string>();
	const people: AddressPart[] = [];
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const angled = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
		const email = (angled?.[2] ?? trimmed).trim().toLowerCase();
		if (!email.includes('@') || seen.has(email)) continue;
		seen.add(email);
		const rawName = angled?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
		people.push({ name: rawName || email, email });
	}
	return people;
}
