import type { EmailProviderKind } from '$lib/types';
import { DEFAULT_LOCALE } from '$lib/i18n/locales';
import { translate } from '$lib/i18n/translate';

export function providerName(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.resend');
		case 'cloudflare':
			return translate(locale, 'provider.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function missingProviderTitle(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.missingTitle.resend');
		case 'cloudflare':
			return translate(locale, 'provider.missingTitle.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function missingProviderHint(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.missingHint.resend');
		case 'cloudflare':
			return translate(locale, 'provider.missingHint.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsTitle(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.noDomainsTitle.resend');
		case 'cloudflare':
			return translate(locale, 'provider.noDomainsTitle.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsBody(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.noDomainsBody.resend');
		case 'cloudflare':
			return translate(locale, 'provider.noDomainsBody.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function domainPickerSubtitle(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.domainPickerSubtitle.resend');
		case 'cloudflare':
			return translate(locale, 'provider.domainPickerSubtitle.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function onboardingSubtitle(kind: EmailProviderKind, locale: string = DEFAULT_LOCALE): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.onboardingSubtitle.resend');
		case 'cloudflare':
			return translate(locale, 'provider.onboardingSubtitle.cloudflare');
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function receivingHint(
	kind: EmailProviderKind,
	domainName: string,
	locale: string = DEFAULT_LOCALE
): string {
	switch (kind) {
		case 'resend':
			return translate(locale, 'provider.receivingHint.resend', { domain: domainName });
		case 'cloudflare':
			return translate(locale, 'provider.receivingHint.cloudflare', { domain: domainName });
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}
