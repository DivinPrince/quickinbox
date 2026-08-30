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
