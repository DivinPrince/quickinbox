import { DEFAULT_LOCALE } from '$lib/i18n/locales';
import { translate } from '$lib/i18n/translate';

export function formatDeviceActivity(value: string | null, locale: string = DEFAULT_LOCALE): string {
	if (!value) return translate(locale, 'device.neverUsed');
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return translate(locale, 'device.unavailable');
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return translate(locale, 'device.justNow');
	if (seconds < 3600) {
		return translate(locale, 'device.minutesAgo', { count: Math.floor(seconds / 60) });
	}
	if (seconds < 86400) {
		return translate(locale, 'device.hoursAgo', { count: Math.floor(seconds / 3600) });
	}
	return translate(locale, 'device.daysAgo', { count: Math.floor(seconds / 86400) });
}
