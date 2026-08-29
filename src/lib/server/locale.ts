import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_LOCALE, parseLocale, type Locale } from '$lib/i18n/locales';

export async function getUserLocale(db: D1Database, userId: string): Promise<Locale> {
	const row = await db
		.prepare('SELECT locale FROM users WHERE id = ?')
		.bind(userId)
		.first<{ locale: string | null }>();
	return parseLocale(row?.locale ?? DEFAULT_LOCALE);
}

export async function setUserLocale(db: D1Database, userId: string, locale: string): Promise<Locale> {
	const resolved = parseLocale(locale);
	await db.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(resolved, userId).run();
	return resolved;
}
