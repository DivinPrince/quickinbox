import type { AvailableDomain, EmailProviderKind, MailStatus } from '$lib/types';
import type { OutboundMailInput, OutboundMailResult } from './send-mail';

export type { EmailProviderKind };

export type ProviderDomain = {
	id: string;
	name: string;
	status: string;
	region?: string | null;
	sendingEnabled: boolean;
	receivingEnabled: boolean;
};

export type EmailProvider = {
	kind: EmailProviderKind;
	send(input: OutboundMailInput): Promise<OutboundMailResult>;
	listDomains(): Promise<ProviderDomain[]>;
	getDomain(id: string): Promise<ProviderDomain>;
};

export class ProviderError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ProviderError';
		this.status = status;
		this.code = code;
	}
}

export function toAvailableDomain(domain: ProviderDomain, connected: boolean): AvailableDomain {
	return {
		id: domain.id,
		name: domain.name,
		status: domain.status,
		region: domain.region ?? null,
		can_send: domain.sendingEnabled,
		can_receive: domain.receivingEnabled,
		connected
	};
}

/** Outbound rows stay queued until Resend webhooks land; Cloudflare send() is already accepted. */
export function initialOutboundStatus(kind: EmailProviderKind): MailStatus {
	switch (kind) {
		case 'resend':
			return 'queued';
		case 'cloudflare':
			return 'sent';
		default: {
			const _never: never = kind;
			return _never;
		}
	}
}

export function providerLabel(kind: EmailProviderKind): string {
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

/**
 * Parses one provider setting: empty, `none` or `off` mean no service,
 * `resend` / `cloudflare` name one. `valid: false` means an unknown value.
 */
export function parseProviderKind(value: string | undefined | null): {
	kind: EmailProviderKind | null;
	valid: boolean;
} {
	const raw = value?.trim().toLowerCase() ?? '';
	if (raw === '' || raw === 'none' || raw === 'off') return { kind: null, valid: true };
	if (raw === 'resend' || raw === 'cloudflare') return { kind: raw, valid: true };
	return { kind: null, valid: false };
}

export type MailDirection = 'inbound' | 'outbound';

type MailKindEnv = {
	EMAIL_PROVIDER?: string;
	EMAIL_INBOUND?: string;
	EMAIL_OUTBOUND?: string;
};

/**
 * The service for one direction. `EMAIL_INBOUND` / `EMAIL_OUTBOUND` win when
 * set (`none` or `off` turns that direction off). When one is empty or unset
 * the direction follows `EMAIL_PROVIDER`, as before, so deployments that only
 * set `EMAIL_PROVIDER` keep working unchanged. `name` is the variable that
 * decided the answer, for error messages; `valid: false` means that value is
 * not a known service.
 */
export function resolveMailKind(
	env: MailKindEnv | undefined | null,
	direction: MailDirection
): { kind: EmailProviderKind | null; valid: boolean; name: string; raw: string } {
	const name = direction === 'inbound' ? 'EMAIL_INBOUND' : 'EMAIL_OUTBOUND';
	const explicit = (direction === 'inbound' ? env?.EMAIL_INBOUND : env?.EMAIL_OUTBOUND)?.trim();
	if (explicit) {
		const parsed = parseProviderKind(explicit);
		return { ...parsed, name, raw: explicit };
	}

	const legacy = env?.EMAIL_PROVIDER?.trim() ?? '';
	const lower = legacy.toLowerCase();
	if (lower === '' || lower === 'resend') return { kind: 'resend', valid: true, name: 'EMAIL_PROVIDER', raw: legacy };
	if (lower === 'cloudflare') return { kind: 'cloudflare', valid: true, name: 'EMAIL_PROVIDER', raw: legacy };
	return { kind: null, valid: false, name: 'EMAIL_PROVIDER', raw: legacy };
}

/**
 * Whether a domain can *receive* depends on who delivers inbound mail, which
 * need not be the service that lists the domain (Resend reports receiving off
 * for a domain that Cloudflare routes). For Cloudflare inbound a domain
 * receives when it is listed in CLOUDFLARE_MAIL_DOMAINS; for Resend inbound
 * with a different lister, `resendDomains` supplies Resend's own answer; with
 * inbound off nothing receives.
 */
export function withInbound(
	provider: EmailProvider,
	inbound: EmailProviderKind | null,
	cloudflareDomains: string | undefined | null,
	resendDomains?: () => Promise<ProviderDomain[]>
): EmailProvider {
	if (inbound === provider.kind) return provider;

	// Resend delivers inbound but another service lists the domains: the lister's
	// own "receiving" flag says nothing about Resend, so ask Resend. A domain
	// Resend does not know, or cannot receive for, is not receiving; so is every
	// domain when Resend cannot be asked (no API key). A failed lookup is an
	// error, not "not receiving": saving that would flip a working domain's
	// status after a brief outage.
	if (inbound === 'resend') {
		const key = (name: string) => name.trim().toLowerCase().replace(/\.$/, '');
		// Asked once per provider instance: connecting several domains calls
		// getDomain repeatedly and would otherwise list Resend's domains each time.
		let cached: Promise<Set<string>> | undefined;
		const receivable = (): Promise<Set<string>> =>
			(cached ??= (async () => {
				if (!resendDomains) return new Set<string>();
				try {
					const remote = await resendDomains();
					return new Set(remote.filter((d) => d.receivingEnabled).map((d) => key(d.name)));
				} catch (error) {
					throw new ProviderError(
						502,
						'resend_receiving_lookup_failed',
						`Could not check Resend's receiving status; try again. ${
							error instanceof Error ? error.message : ''
						}`.trim()
					);
				}
			})());
		const mark = (domain: ProviderDomain, ok: Set<string>): ProviderDomain => ({
			...domain,
			receivingEnabled: ok.has(key(domain.name))
		});
		return {
			...provider,
			async listDomains() {
				const [ok, domains] = await Promise.all([receivable(), provider.listDomains()]);
				return domains.map((domain) => mark(domain, ok));
			},
			async getDomain(id: string) {
				const [ok, domain] = await Promise.all([receivable(), provider.getDomain(id)]);
				return mark(domain, ok);
			}
		};
	}

	const routed = new Set(parseMailDomains(cloudflareDomains));
	const adjust = (domain: ProviderDomain): ProviderDomain => ({
		...domain,
		receivingEnabled: inbound === 'cloudflare' && routed.has(domain.name.toLowerCase())
	});

	return {
		...provider,
		async listDomains() {
			return (await provider.listDomains()).map(adjust);
		},
		async getDomain(id: string) {
			return adjust(await provider.getDomain(id));
		}
	};
}

/** Lists domains but cannot send — used when EMAIL_OUTBOUND is "none". */
export function withoutSending(provider: EmailProvider): EmailProvider {
	return {
		...provider,
		async send() {
			throw new ProviderError(
				503,
				'sending_disabled',
				'Sending is turned off (EMAIL_OUTBOUND is "none"). Set it to "resend" or "cloudflare" to send mail.'
			);
		},
		async listDomains() {
			return (await provider.listDomains()).map((domain) => ({ ...domain, sendingEnabled: false }));
		},
		async getDomain(id: string) {
			return { ...(await provider.getDomain(id)), sendingEnabled: false };
		}
	};
}

/** IANA reserved names used as dashboard placeholders; not real mail domains. */
const TEMPLATE_PLACEHOLDER_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

export function parseMailDomains(value: string | undefined | null): string[] {
	if (!value?.trim()) return [];
	const seen = new Set<string>();
	const domains: string[] = [];

	for (const part of value.split(',')) {
		const name = part.trim().toLowerCase().replace(/^@/, '');
		if (!name || seen.has(name) || TEMPLATE_PLACEHOLDER_DOMAINS.has(name)) continue;
		seen.add(name);
		domains.push(name);
	}

	return domains;
}
