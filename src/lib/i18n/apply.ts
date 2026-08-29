import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_STORAGE_KEY, parseLocale } from './locales';

export function persistLocale(locale: string): void {
	const resolved = parseLocale(locale);
	document.documentElement.lang = resolved;
	localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
	document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(resolved)}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export async function switchLocale(locale: string): Promise<void> {
	persistLocale(locale);
	await fetch('/api/settings/locale', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ locale })
	});
	window.location.reload();
}
