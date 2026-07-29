/**
 * Local-only Resend stand-in used when RESEND_API_KEY=demo_local.
 * Lets setup/onboarding and outbound send work without a real Resend account.
 *
 * Domain name comes from DEMO_MAIL_DOMAIN (see .dev.vars) so personal hostnames
 * never have to be hard-coded in the template.
 */
import type {
	ReceivedAttachment,
	ReceivedEmail,
	ResendClient,
	ResendDomain,
	SendEmailPayload
} from './resend';

export const DEMO_RESEND_KEY = 'demo_local';
export const DEMO_DOMAIN_ID = 'dom_demo_mail';

export function isDemoResendKey(apiKey: string | undefined | null): boolean {
	return apiKey === DEMO_RESEND_KEY;
}

export function resolveDemoDomainName(envDomain?: string | null): string {
	const raw = (envDomain ?? 'demo.local').trim().toLowerCase();
	return raw || 'demo.local';
}

export function buildDemoDomain(name: string): ResendDomain {
	return {
		id: DEMO_DOMAIN_ID,
		name,
		status: 'verified',
		created_at: '2026-01-01T00:00:00.000Z',
		region: 'us-east-1',
		capabilities: {
			sending: 'enabled',
			receiving: 'enabled'
		},
		records: [
			{
				record: 'SPF',
				name: 'send',
				type: 'TXT',
				value: 'v=spf1 include:amazonses.com ~all',
				status: 'verified'
			},
			{
				record: 'DKIM',
				name: 'resend._domainkey',
				type: 'TXT',
				value: 'p=demo',
				status: 'verified'
			},
			{
				record: 'MX',
				name: '',
				type: 'MX',
				value: 'inbound-smtp.us-east-1.amazonaws.com',
				priority: 10,
				status: 'verified'
			}
		]
	};
}

export function createDemoResendClient(envDomain?: string | null): ResendClient {
	const domain = buildDemoDomain(resolveDemoDomainName(envDomain));

	return {
		async send(_payload: SendEmailPayload, _idempotencyKey?: string): Promise<{ id: string }> {
			return { id: `demo_msg_${crypto.randomUUID()}` };
		},

		async listDomains(): Promise<ResendDomain[]> {
			return [domain];
		},

		async getDomain(id: string): Promise<ResendDomain> {
			if (id !== DEMO_DOMAIN_ID) {
				throw new Error(`Demo Resend: unknown domain ${id}`);
			}
			return domain;
		},

		async getReceivedEmail(_id: string, _htmlFormat?: 'data_uri' | 'cid'): Promise<ReceivedEmail> {
			throw new Error('Demo Resend: inbound fetch is not simulated');
		},

		async listReceivedAttachments(_id: string): Promise<ReceivedAttachment[]> {
			return [];
		},

		async downloadAttachment(_url: string): Promise<Uint8Array> {
			return new Uint8Array();
		}
	};
}
