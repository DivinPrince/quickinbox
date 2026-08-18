import {
	createResendClient,
	isDomainReceivable,
	isDomainSendable,
	ResendError,
	type ResendClient,
	type ResendDomain
} from '../resend';
import type { EmailProvider, ProviderDomain } from '../email-provider';
import { ProviderError } from '../email-provider';
import type { OutboundMailInput, OutboundMailResult } from '../send-mail';

export function createResendProvider(apiKey: string): EmailProvider {
	const client = createResendClient(apiKey);

	return {
		kind: 'resend',
		async send(input: OutboundMailInput): Promise<OutboundMailResult> {
			try {
				const result = await client.send(
					{
						from: `${input.senderName} <${input.from.address}>`,
						to: input.to,
						...(input.cc?.length ? { cc: input.cc } : {}),
						...(input.bcc?.length ? { bcc: input.bcc } : {}),
						reply_to: input.from.address,
						subject: input.subject,
						text: input.text,
						html: input.html,
						...(input.headers && Object.keys(input.headers).length
							? { headers: input.headers }
							: {}),
						...(input.attachments?.length
							? {
									attachments: input.attachments.map((file) => ({
										filename: file.filename,
										content: file.content,
										content_type: file.type
									}))
								}
							: {})
					},
					input.idempotencyKey
				);

				return { providerId: result.id };
			} catch (error) {
				throw wrapResendError(error);
			}
		},
		async listDomains(): Promise<ProviderDomain[]> {
			try {
				const remote = await client.listDomains();
				return remote.map(toProviderDomain);
			} catch (error) {
				throw wrapResendError(error);
			}
		},
		async getDomain(id: string): Promise<ProviderDomain> {
			try {
				return toProviderDomain(await client.getDomain(id));
			} catch (error) {
				throw wrapResendError(error);
			}
		}
	};
}

/** Webhook ingest still needs the receiving endpoints on the raw client. */
export function getResendReceivingClient(apiKey: string): ResendClient {
	return createResendClient(apiKey);
}

function toProviderDomain(domain: ResendDomain): ProviderDomain {
	return {
		id: domain.id,
		name: domain.name,
		status: domain.status,
		region: domain.region ?? null,
		sendingEnabled: isDomainSendable(domain),
		receivingEnabled: isDomainReceivable(domain)
	};
}

function wrapResendError(error: unknown): ProviderError {
	if (error instanceof ProviderError) return error;
	if (error instanceof ResendError) {
		return new ProviderError(error.status, error.code, error.message);
	}
	return new ProviderError(
		502,
		'resend_error',
		error instanceof Error ? error.message : 'Resend request failed'
	);
}
