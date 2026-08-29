import { get } from 'svelte/store';
import { page } from '$app/stores';
import { DEFAULT_LOCALE, parseLocale } from './locales';
import { translate, type TranslateParams } from './translate';

function pageLocale(): string {
	try {
		const locale = (get(page).data as { locale?: string } | undefined)?.locale;
		return parseLocale(locale);
	} catch {
		return DEFAULT_LOCALE;
	}
}

/** Translate using the active page locale (falls back to English). */
export function t(key: string, params?: TranslateParams): string {
	return translate(pageLocale(), key, params);
}
