import type { AvailableDomain } from '$lib/types';
import {
	parseMailDomains,
	ProviderError,
	toAvailableDomain,
	type EmailProvider,
	type EmailProviderKind
} from './email-provider';
import { ConfigError } from './errors';
import { createCloudflareProvider } from './providers/cloudflare-provider';
import { createResendProvider, getResendReceivingClient } from './providers/resend-provider';
import type { ResendClient } from './resend';

export { ConfigError } from './errors';
export { ProviderError } from './email-provider';

type PlatformLike = App.Platform | undefined | null;

export function getEmailProviderKind(platform: PlatformLike): EmailProviderKind {
	const raw = platform?.env.EMAIL_PROVIDER?.trim().toLowerCase();
	if (!raw || raw === 'resend') return 'resend';
	if (raw === 'cloudflare') return 'cloudflare';
	throw new ConfigError(`Unknown EMAIL_PROVIDER "${platform?.env.EMAIL_PROVIDER}". Use "resend" or "cloudflare".`);
}

export function safeEmailProviderKind(platform: PlatformLike): EmailProviderKind {
	try {
		return getEmailProviderKind(platform);
	} catch {
		return 'resend';
	}
}

export function getEmailProvider(platform: PlatformLike): EmailProvider {
	const kind = getEmailProviderKind(platform);

	switch (kind) {
		case 'resend': {
			const apiKey = platform?.env.RESEND_API_KEY;
			if (!apiKey) {
				throw new ConfigError(
					'RESEND_API_KEY is not set. Add it with `wrangler secret put RESEND_API_KEY` (or to .dev.vars locally).'
				);
			}
			return createResendProvider(apiKey);
		}
		case 'cloudflare': {
			const email = platform?.env.EMAIL;
			if (!email) {
				throw new ConfigError(
					'Cloudflare Email binding EMAIL is missing. Add a send_email binding named EMAIL in wrangler.jsonc.'
				);
			}
			return createCloudflareProvider(email, platform?.env.CLOUDFLARE_MAIL_DOMAINS ?? '');
		}
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function hasProviderConfigured(platform: PlatformLike): boolean {
	try {
		const kind = getEmailProviderKind(platform);
		switch (kind) {
			case 'resend':
				return Boolean(platform?.env.RESEND_API_KEY);
			case 'cloudflare':
				return Boolean(platform?.env.EMAIL) && parseMailDomains(platform?.env.CLOUDFLARE_MAIL_DOMAINS).length > 0;
			default: {
				const _never: never = kind;
				return _never;
			}
		}
	} catch {
		return false;
	}
}

export async function listAvailableDomains(
	platform: PlatformLike,
	connectedIds: Iterable<string> = []
): Promise<AvailableDomain[]> {
	const connected = new Set(connectedIds);
	const remote = await getEmailProvider(platform).listDomains();
	return remote.map((domain) => toAvailableDomain(domain, connected.has(domain.id)));
}

/** Resend receiving API — used only by the Resend webhook handler. */
export function getResendClient(platform: PlatformLike): ResendClient {
	const apiKey = platform?.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new ConfigError(
			'RESEND_API_KEY is not set. Add it with `wrangler secret put RESEND_API_KEY` (or to .dev.vars locally).'
		);
	}
	return getResendReceivingClient(apiKey);
}

export function getWebhookSecret(platform: PlatformLike): string | null {
	return platform?.env.RESEND_WEBHOOK_SECRET ?? null;
}

export function providerLoadError(kind: EmailProviderKind, error: unknown): string {
	if (error instanceof ConfigError || error instanceof ProviderError) return error.message;
	switch (kind) {
		case 'resend':
			return 'Could not reach Resend. Check the API key and try again.';
		case 'cloudflare':
			return 'Could not load Cloudflare Email domains. Check EMAIL_PROVIDER and CLOUDFLARE_MAIL_DOMAINS.';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function describeProviderError(error: unknown, fallback = 'Failed to send email'): string {
	if (error instanceof ConfigError || error instanceof ProviderError) return error.message;
	return error instanceof Error ? error.message : fallback;
}

export function statusForProviderError(error: unknown): number {
	if (error instanceof ConfigError) return 503;
	if (error instanceof ProviderError) return error.status >= 500 ? 502 : 400;
	return 400;
}
