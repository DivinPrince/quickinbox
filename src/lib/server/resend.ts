/**
 * Minimal typed client for the Resend REST API.
 *
 * Covers everything this app needs: sending, domain discovery (used by
 * onboarding) and the inbound "receiving" endpoints. Written against fetch so
 * it runs on Workers without pulling in the Node SDK.
 *
 * Docs: https://resend.com/docs/api-reference
 */

const API_BASE = 'https://api.resend.com';

export class ResendError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ResendError';
		this.status = status;
		this.code = code;
	}
}

export type ResendDomainStatus =
	| 'not_started'
	| 'pending'
	| 'verified'
	| 'failed'
	| 'temporary_failure';

export type ResendDomainRecord = {
	record: string;
	name: string;
	type: string;
	value: string;
	ttl?: string;
	status?: string;
	priority?: number;
};

export type ResendDomain = {
	id: string;
	name: string;
	status: ResendDomainStatus;
	created_at: string;
	region: string;
	capabilities?: {
		sending?: 'enabled' | 'disabled';
		receiving?: 'enabled' | 'disabled';
	};
	records?: ResendDomainRecord[];
};

export type SendEmailPayload = {
	from: string;
	to: string | string[];
	subject: string;
	cc?: string | string[];
	bcc?: string | string[];
	reply_to?: string | string[];
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	attachments?: Array<{
		filename: string;
		content?: string;
		path?: string;
		content_type?: string;
		content_id?: string;
	}>;
	tags?: Array<{ name: string; value: string }>;
	scheduled_at?: string;
};

export type ReceivedAttachment = {
	id: string;
	filename: string;
	content_type: string;
	content_disposition?: string;
	content_id?: string;
	size?: number;
	download_url?: string;
	expires_at?: string;
};

export type ReceivedEmail = {
	object: 'email';
	id: string;
	from: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	reply_to?: string[];
	subject: string | null;
	html: string | null;
	text: string | null;
	headers?: Record<string, string>;
	created_at: string;
	message_id?: string | null;
	received_for?: string[];
	attachments?: ReceivedAttachment[];
};

type ListResponse<T> = { object: 'list'; has_more: boolean; data: T[] };

export type ResendClient = ReturnType<typeof createResendClient>;

export function createResendClient(apiKey: string) {
	if (!apiKey) {
		throw new ResendError(500, 'missing_api_key', 'RESEND_API_KEY is not configured');
	}

	async function request<T>(
		path: string,
		init: RequestInit & { idempotencyKey?: string } = {}
	): Promise<T> {
		const { idempotencyKey, ...rest } = init;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`,
			...(rest.body ? { 'Content-Type': 'application/json' } : {}),
			...((rest.headers as Record<string, string>) ?? {})
		};

		if (idempotencyKey) {
			headers['Idempotency-Key'] = idempotencyKey;
		}

		const response = await fetch(`${API_BASE}${path}`, { ...rest, headers });
		const raw = await response.text();
		const parsed = raw ? safeJsonParse(raw) : null;

		if (!response.ok) {
			const error = (parsed ?? {}) as { name?: string; message?: string; error?: string };
			throw new ResendError(
				response.status,
				error.name ?? 'resend_error',
				error.message ?? error.error ?? `Resend request failed (${response.status})`
			);
		}

		return parsed as T;
	}

	return {
		/** POST /emails — https://resend.com/docs/api-reference/emails/send-email */
		async send(payload: SendEmailPayload, idempotencyKey?: string): Promise<{ id: string }> {
			return request<{ id: string }>('/emails', {
				method: 'POST',
				body: JSON.stringify(payload),
				idempotencyKey
			});
		},

		/** GET /domains — used by onboarding to show what this key can reach. */
		async listDomains(): Promise<ResendDomain[]> {
			const result = await request<ListResponse<ResendDomain>>('/domains?limit=100');
			return result?.data ?? [];
		},

		/** GET /domains/:id — includes the DNS `records` array (SPF/DKIM/MX). */
		async getDomain(id: string): Promise<ResendDomain> {
			return request<ResendDomain>(`/domains/${id}`);
		},

		/** GET /emails/receiving/:id — full inbound message (webhooks carry metadata only). */
		async getReceivedEmail(
			id: string,
			htmlFormat: 'data_uri' | 'cid' = 'data_uri'
		): Promise<ReceivedEmail> {
			return request<ReceivedEmail>(`/emails/receiving/${id}?html_format=${htmlFormat}`);
		},

		/** GET /emails/receiving/:id/attachments — metadata plus signed download_url. */
		async listReceivedAttachments(id: string): Promise<ReceivedAttachment[]> {
			const result = await request<ListResponse<ReceivedAttachment>>(
				`/emails/receiving/${id}/attachments`
			);
			return result?.data ?? [];
		},

		/** Signed URLs are pre-authenticated — no bearer token here. */
		async downloadAttachment(url: string): Promise<Uint8Array> {
			const response = await fetch(url);
			if (!response.ok) {
				throw new ResendError(
					response.status,
					'attachment_download_failed',
					`Failed to download attachment (${response.status})`
				);
			}
			return new Uint8Array(await response.arrayBuffer());
		}
	};
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** Resend requires a verified domain before it will accept a send. */
export function isDomainSendable(domain: ResendDomain): boolean {
	return domain.status === 'verified' && domain.capabilities?.sending !== 'disabled';
}

export function isDomainReceivable(domain: ResendDomain): boolean {
	return domain.capabilities?.receiving === 'enabled';
}
