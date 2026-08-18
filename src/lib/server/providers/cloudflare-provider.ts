import { base64ToBytes } from '../attachments';
import { parseMailDomains, ProviderError, type EmailProvider, type ProviderDomain } from '../email-provider';
import type { OutboundMailInput, OutboundMailResult } from '../send-mail';

/**
 * Structured Email Service binding. `@cloudflare/workers-types` does not yet
 * ship `SendEmail`, so the shape is declared here against the Workers API.
 * https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */
export type CloudflareSendEmailBinding = {
	send(payload: CloudflareSendPayload): Promise<{ messageId: string }>;
};

export type CloudflareSendPayload = {
	to: string | string[];
	from: string | { email: string; name?: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name?: string };
	headers?: Record<string, string>;
	attachments?: Array<{
		content: string | ArrayBuffer | ArrayBufferView;
		filename: string;
		type?: string;
		disposition?: 'attachment' | 'inline';
		contentId?: string;
	}>;
};

export function createCloudflareProvider(
	email: CloudflareSendEmailBinding,
	configuredDomains: string
): EmailProvider {
	return {
		kind: 'cloudflare',
		async send(input: OutboundMailInput): Promise<OutboundMailResult> {
			try {
				const response = await email.send({
					to: input.to,
					from: { email: input.from.address, name: input.senderName },
					replyTo: input.from.address,
					subject: input.subject,
					text: input.text,
					html: input.html,
					...(input.cc?.length ? { cc: input.cc } : {}),
					...(input.bcc?.length ? { bcc: input.bcc } : {}),
					...(input.headers && Object.keys(input.headers).length
						? { headers: input.headers }
						: {}),
					...(input.attachments?.length
						? {
								attachments: input.attachments.map((file) => ({
									filename: file.filename,
									type: file.type,
									content: base64ToArrayBuffer(file.content),
									disposition: 'attachment' as const
								}))
							}
						: {})
				});

				if (!response?.messageId) {
					throw new ProviderError(502, 'missing_message_id', 'Cloudflare Email did not return a message id');
				}

				return { providerId: response.messageId };
			} catch (error) {
				throw wrapCloudflareError(error);
			}
		},
		async listDomains(): Promise<ProviderDomain[]> {
			return parseMailDomains(configuredDomains).map(cloudflareDomain);
		},
		async getDomain(id: string): Promise<ProviderDomain> {
			const domains = parseMailDomains(configuredDomains);
			const match = domains.find((name) => name === id.toLowerCase());
			if (!match) {
				throw new ProviderError(
					404,
					'domain_not_configured',
					`${id} is not in CLOUDFLARE_MAIL_DOMAINS`
				);
			}
			return cloudflareDomain(match);
		}
	};
}

function cloudflareDomain(name: string): ProviderDomain {
	return {
		id: name,
		name,
		status: 'verified',
		region: null,
		sendingEnabled: true,
		receivingEnabled: true
	};
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const bytes = base64ToBytes(base64);
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function wrapCloudflareError(error: unknown): ProviderError {
	if (error instanceof ProviderError) return error;

	const code =
		error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
			? error.code
			: 'send_failed';
	const message = error instanceof Error ? error.message : 'Cloudflare Email rejected the message';
	const status = code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_INTERNAL_SERVER_ERROR' ? 502 : 400;

	return new ProviderError(status, code, message);
}
