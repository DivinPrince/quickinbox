export const LOCALES = ['en', 'fr', 'zh-CN', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'qi_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_STORAGE_KEY = 'quickinbox:locale';

export const LOCALE_OPTIONS: { id: Locale; name: string; nativeName: string }[] = [
	{ id: 'en', name: 'English', nativeName: 'English' },
	{ id: 'fr', name: 'French', nativeName: 'Français' },
	{ id: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
	{ id: 'es', name: 'Spanish', nativeName: 'Español' }
];

/** Compact header label (EN / FR / ZH / ES). */
export function localeShortLabel(locale: Locale): string {
	switch (locale) {
		case 'en':
			return 'EN';
		case 'fr':
			return 'FR';
		case 'zh-CN':
			return 'ZH';
		case 'es':
			return 'ES';
		default: {
			const exhaustive: never = locale;
			return exhaustive;
		}
	}
}

export function isLocale(value: string | null | undefined): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Exact or language-prefix match; unknown values return null. */
export function matchLocale(value: string | null | undefined): Locale | null {
	if (!value) return null;
	const lower = value.trim().toLowerCase().replaceAll('_', '-');
	if (!lower) return null;

	const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
	if (exact) return exact;

	const language = lower.split('-')[0] ?? '';
	if (language === 'zh') return 'zh-CN';
	const prefixed = LOCALES.find(
		(locale) => locale.toLowerCase() === language || locale.toLowerCase().startsWith(`${language}-`)
	);
	return prefixed ?? null;
}

export function parseLocale(value: string | null | undefined): Locale {
	return matchLocale(value) ?? DEFAULT_LOCALE;
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
	if (!header) return DEFAULT_LOCALE;

	const ranked = header
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const quality = params.find((param) => param.trim().startsWith('q='));
			return {
				tag: tag?.trim() ?? '',
				q: quality ? Number(quality.trim().slice(2)) : 1
			};
		})
		.filter((entry) => entry.tag)
		.sort((a, b) => b.q - a.q);

	for (const entry of ranked) {
		const matched = matchLocale(entry.tag);
		if (matched) return matched;
	}

	return DEFAULT_LOCALE;
}

/** BCP 47 tag for `Intl` formatters. */
export function intlLocale(locale: string): string {
	return parseLocale(locale);
}
