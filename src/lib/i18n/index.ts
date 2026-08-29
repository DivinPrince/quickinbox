export {
	DEFAULT_LOCALE,
	LOCALES,
	LOCALE_COOKIE,
	LOCALE_COOKIE_MAX_AGE,
	LOCALE_OPTIONS,
	LOCALE_STORAGE_KEY,
	intlLocale,
	isLocale,
	localeFromAcceptLanguage,
	localeShortLabel,
	matchLocale,
	parseLocale,
	type Locale
} from './locales';
export { t } from './t';
export { plural, translate, type TranslateParams } from './translate';
export { persistLocale, switchLocale } from './apply';
