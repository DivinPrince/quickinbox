import type { AvailableDomain } from '$lib/types';
import {
	parseMailDomains,
	ProviderError,
	resolveMailKind,
	toAvailableDomain,
	withInbound,
	withoutSending,
	type EmailProvider,
	type EmailProviderKind
} from './email-provider';
import { ConfigError } from './errors';
import { ReplyGuardError } from './outbox';
import { SendAttemptError } from './send-attempts';
import { SendPolicyError } from './send-policy';
import { createCloudflareProvider } from './providers/cloudflare-provider';
import { createResendProvider, getResendReceivingClient } from './providers/resend-provider';
import type { ResendClient } from './resend';

export { ConfigError } from './errors';
export { ProviderError } from './email-provider';

type PlatformLike = App.Platform | undefined | null;

function readKind(platform: PlatformLike, direction: 'inbound' | 'outbound'): EmailProviderKind | null {
	const resolved = resolveMailKind(platform?.env, direction);
	if (!resolved.valid) {
		throw new ConfigError(
			resolved.name === 'EMAIL_PROVIDER'
				? `Unknown EMAIL_PROVIDER "${resolved.raw}". Use "resend" or "cloudflare".`
				: `Unknown ${resolved.name} "${resolved.raw}". Use "resend", "cloudflare", or "none".`
		);
	}
	return resolved.kind;
}

/** Who delivers inbound mail (`EMAIL_INBOUND`, else `EMAIL_PROVIDER`); null when receiving is off. */
export function getInboundProviderKind(platform: PlatformLike): EmailProviderKind | null {
	return readKind(platform, 'inbound');
}

/** Who sends mail (`EMAIL_OUTBOUND`, else `EMAIL_PROVIDER`); null when sending is off. */
export function getOutboundProviderKind(platform: PlatformLike): EmailProviderKind | null {
	return readKind(platform, 'outbound');
}

export function safeInboundProviderKind(platform: PlatformLike): EmailProviderKind | null {
	try {
		return getInboundProviderKind(platform);
	} catch {
		return null;
	}
}

/**
 * The service domains are listed from and connected through: the outbound
 * service when sending is on (its idea of "verified" is what makes a domain
 * usable), otherwise the inbound one. Both off means nothing is configured.
 */
export function getEmailProviderKind(platform: PlatformLike): EmailProviderKind {
	const kind = getOutboundProviderKind(platform) ?? getInboundProviderKind(platform);
	if (!kind) {
		throw new ConfigError(
			'Mail is turned off: EMAIL_INBOUND and EMAIL_OUTBOUND are both "none". Set at least one to "resend" or "cloudflare".'
		);
	}
	return kind;
}

export function safeEmailProviderKind(platform: PlatformLike): EmailProviderKind {
	try {
		return getEmailProviderKind(platform);
	} catch {
		return 'resend';
	}
}

function buildProvider(kind: EmailProviderKind, platform: PlatformLike, canSend: boolean): EmailProvider {
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
			if (canSend && !email) {
				throw new ConfigError(
					'Cloudflare Email binding EMAIL is missing. Add a send_email binding named EMAIL in wrangler.jsonc.'
				);
			}
			return createCloudflareProvider(
				email ?? {
					async send() {
						throw new ProviderError(503, 'sending_disabled', 'Cloudflare sending is not configured');
					}
				},
				platform?.env.CLOUDFLARE_MAIL_DOMAINS ?? ''
			);
		}
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

/** The provider for sending. Throws a ConfigError while sending is off (EMAIL_OUTBOUND=none). */
export function getEmailProvider(platform: PlatformLike): EmailProvider {
	const outbound = getOutboundProviderKind(platform);
	if (!outbound) {
		throw new ConfigError(
			'Sending is turned off (EMAIL_OUTBOUND is "none"). Set it to "resend" or "cloudflare" to send mail.'
		);
	}
	return withInbound(
		buildProvider(outbound, platform, true),
		getInboundProviderKind(platform),
		platform?.env.CLOUDFLARE_MAIL_DOMAINS,
		resendReceivingLookup(platform, outbound)
	);
}

/**
 * When Resend delivers inbound mail but another service lists the domains,
 * Resend is asked which domains it can receive for. Unavailable without an API key.
 */
function resendReceivingLookup(platform: PlatformLike, lister: EmailProviderKind) {
	const apiKey = platform?.env.RESEND_API_KEY;
	if (lister === 'resend' || getInboundProviderKind(platform) !== 'resend' || !apiKey) return undefined;
	return () => createResendProvider(apiKey).listDomains();
}

/**
 * The provider for listing and connecting domains. It cannot send when
 * sending is off (EMAIL_OUTBOUND=none), and reports receiving according to EMAIL_INBOUND.
 */
export function getDomainProvider(platform: PlatformLike): EmailProvider {
	const outbound = getOutboundProviderKind(platform);
	const kind = getEmailProviderKind(platform);
	const base = buildProvider(kind, platform, outbound !== null);
	return withInbound(
		outbound ? base : withoutSending(base),
		getInboundProviderKind(platform),
		platform?.env.CLOUDFLARE_MAIL_DOMAINS,
		resendReceivingLookup(platform, kind)
	);
}

export function hasProviderConfigured(platform: PlatformLike): boolean {
	try {
		const outbound = getOutboundProviderKind(platform);
		const inbound = getInboundProviderKind(platform);
		if (!outbound && !inbound) return false;

		const configured = (kind: EmailProviderKind): boolean => {
			switch (kind) {
				case 'resend':
					return Boolean(platform?.env.RESEND_API_KEY);
				case 'cloudflare':
					return (
						parseMailDomains(platform?.env.CLOUDFLARE_MAIL_DOMAINS).length > 0 &&
						(outbound !== 'cloudflare' || Boolean(platform?.env.EMAIL))
					);
				default: {
					const _never: never = kind;
					return _never;
				}
			}
		};

		return [outbound, inbound].every((kind) => kind === null || configured(kind));
	} catch {
		return false;
	}
}

export async function listAvailableDomains(
	platform: PlatformLike,
	connectedIds: Iterable<string> = []
): Promise<AvailableDomain[]> {
	const connected = new Set(connectedIds);
	const remote = await getDomainProvider(platform).listDomains();
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
			return 'Could not load Cloudflare Email domains. Check EMAIL_PROVIDER (or EMAIL_INBOUND / EMAIL_OUTBOUND) and CLOUDFLARE_MAIL_DOMAINS.';
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
	if (
		error instanceof SendAttemptError ||
		error instanceof SendPolicyError ||
		error instanceof ReplyGuardError
	) {
		return error.status;
	}
	if (error instanceof ProviderError) return error.status >= 500 ? 502 : 400;
	return 400;
}
