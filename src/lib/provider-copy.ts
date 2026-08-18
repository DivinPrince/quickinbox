import type { EmailProviderKind } from '$lib/types';

export function providerName(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Resend';
		case 'cloudflare':
			return 'Cloudflare Email';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function missingProviderTitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Resend API key missing';
		case 'cloudflare':
			return 'Cloudflare Email is not configured';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function missingProviderHint(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'wrangler secret put RESEND_API_KEY';
		case 'cloudflare':
			return 'EMAIL_PROVIDER=cloudflare\nCLOUDFLARE_MAIL_DOMAINS=yourdomain.com';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsTitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'No domains in this Resend account';
		case 'cloudflare':
			return 'No domains in CLOUDFLARE_MAIL_DOMAINS';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function noDomainsBody(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Add and verify a domain at resend.com/domains, then reload this page.';
		case 'cloudflare':
			return 'Onboard the domain in Cloudflare Email Service, then set CLOUDFLARE_MAIL_DOMAINS and reload.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function domainPickerSubtitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'These are the domains your Resend account can send and receive on. Pick the one you want to use — you can add more later.';
		case 'cloudflare':
			return 'These are the domains listed in CLOUDFLARE_MAIL_DOMAINS. Pick the one you want to use — you can add more later.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function onboardingSubtitle(kind: EmailProviderKind): string {
	switch (kind) {
		case 'resend':
			return 'Pick the domains from your Resend account that you want in this dashboard.';
		case 'cloudflare':
			return 'Pick the domains from CLOUDFLARE_MAIL_DOMAINS that you want in this dashboard.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function receivingHint(kind: EmailProviderKind, domainName: string): string {
	switch (kind) {
		case 'resend':
			return `Receiving isn't enabled on ${domainName} yet — you can send, but inbound mail won't arrive until you add the MX record in Resend.`;
		case 'cloudflare':
			return `Receiving isn't enabled on ${domainName} yet — point Email Routing's catch-all at this Worker.`;
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}
