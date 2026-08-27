import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { DeliveryStatus } from '$lib/types';
import { insertAttachmentBytes } from './attachments';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL, MAX_BODY_BYTES } from './constants';
import { collectInboundRecipients, parseEmailIdentity } from './email-address';
import { recordUnroutedEmail, resolveInboundRoute } from './domains';
import { emailExistsByProviderId, insertEmail, updateEmailStatusByProviderId } from './mail-store';
import { scheduleNewMailNotification, type PushNotificationEnv } from './push-notifications';
import type { ResendClient } from './resend';

export type ResendWebhookEvent = {
	type: string;
	created_at?: string;
	data?: Record<string, unknown>;
};

export type WebhookOutcome = {
	handled: boolean;
	note: string;
};

type InboundEnv = PushNotificationEnv & { ATTACHMENTS: R2Bucket };

/** Resend delivery events → the status we display on a sent message. */
const STATUS_BY_EVENT: Record<string, DeliveryStatus> = {
	'email.sent': 'sent',
	'email.delivered': 'delivered',
	'email.delivery_delayed': 'delayed',
	'email.bounced': 'bounced',
	'email.complained': 'complained',
	'email.failed': 'failed'
};

export async function handleResendWebhook(
	event: ResendWebhookEvent,
	env: InboundEnv,
	client: ResendClient
): Promise<WebhookOutcome> {
	if (event.type === 'email.received') {
		return handleInboundEmail(event, env, client);
	}

	const status = STATUS_BY_EVENT[event.type];
	if (status) {
		return handleDeliveryStatus(event, env.DB, status);
	}

	return { handled: false, note: `Ignored event type ${event.type}` };
}

async function handleDeliveryStatus(
	event: ResendWebhookEvent,
	db: D1Database,
	status: DeliveryStatus
): Promise<WebhookOutcome> {
	const providerId = readString(event.data?.email_id);
	if (!providerId) {
		return { handled: false, note: 'Delivery event without email_id' };
	}

	const detail =
		readString((event.data?.bounce as Record<string, unknown> | undefined)?.message) ??
		readString((event.data?.bounce as Record<string, unknown> | undefined)?.subType) ??
		readString(event.data?.reason) ??
		null;

	await updateEmailStatusByProviderId(db, providerId, status, detail);
	return { handled: true, note: `Marked ${providerId} as ${status}` };
}

async function handleInboundEmail(
	event: ResendWebhookEvent,
	env: InboundEnv,
	client: ResendClient
): Promise<WebhookOutcome> {
	const providerId = readString(event.data?.email_id);
	if (!providerId) {
		return { handled: false, note: 'email.received without email_id' };
	}

	if (await emailExistsByProviderId(env.DB, providerId)) {
		return { handled: true, note: `Already stored ${providerId}` };
	}

	// Webhooks carry metadata only — the body and attachments come from the API.
	let received = await client.getReceivedEmail(providerId, 'data_uri');

	// Inline images inflate data-URI HTML past what we store; fall back to `cid`
	// so the body stays intact and the images remain as attachments.
	if ((received.html?.length ?? 0) > MAX_BODY_BYTES) {
		received = await client.getReceivedEmail(providerId, 'cid');
	}

	const recipients = collectInboundRecipients({
		received_for: (event.data?.received_for as string[] | undefined) ?? received.received_for,
		to: received.to,
		cc: received.cc,
		bcc: received.bcc
	});

	const sender = parseEmailIdentity(received.headers?.['from'] ?? received.from ?? '');
	const from = sender.address;
	const subject = received.subject?.trim() || '(no subject)';
	const route = await resolveInboundRoute(env.DB, recipients);

	if (!route) {
		await recordUnroutedEmail(env.DB, {
			providerId,
			from,
			to: recipients.join(', ') || '(unknown)',
			subject,
			reason: 'No matching address and no catch-all for this domain'
		});
		return { handled: true, note: `Stored ${providerId} as unrouted` };
	}

	const emailId = await insertEmail(env.DB, {
		userId: route.userId,
		direction: 'inbound',
		from,
		fromName: sender.name,
		to: route.address,
		cc: received.cc?.join(', ') || null,
		subject,
		bodyText: received.text,
		bodyHtml: received.html,
		messageId: received.message_id ?? null,
		inReplyTo: received.headers?.['in-reply-to'] ?? null,
		// The whole chain, not just the direct parent: a reply to something we
		// sent references a Message-ID Resend never handed back to us, but the
		// chain still carries the message that started the conversation.
		references: received.headers?.['references'] ?? null,
		domainId: route.domainId,
		addressId: route.addressId,
		providerId
	});

	await storeInboundAttachments(env, client, providerId, emailId);
	await scheduleNewMailNotification(env, {
		emailId,
		userId: route.userId,
		from: sender.name || from,
		subject
	});

	return {
		handled: true,
		note: `Delivered ${providerId} to ${route.address}${route.viaCatchall ? ' (catch-all)' : ''}`
	};
}

async function storeInboundAttachments(
	env: InboundEnv,
	client: ResendClient,
	providerId: string,
	emailId: string
): Promise<void> {
	let attachments;
	try {
		attachments = await client.listReceivedAttachments(providerId);
	} catch (error) {
		console.error('Failed to list inbound attachments', providerId, error);
		return;
	}

	for (const attachment of attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
		if (!attachment.download_url) continue;
		if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
			console.warn(`Skipping oversized attachment ${attachment.filename} on ${providerId}`);
			continue;
		}

		try {
			const bytes = await client.downloadAttachment(attachment.download_url);
			if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;

			await insertAttachmentBytes(env.DB, env.ATTACHMENTS, emailId, {
				filename: attachment.filename || 'attachment',
				type: attachment.content_type || 'application/octet-stream',
				bytes
			});
		} catch (error) {
			// One bad attachment shouldn't cost us the message.
			console.error('Failed to store inbound attachment', attachment.id, error);
		}
	}
}

/** Resend retries on non-2xx, so record ids we've already processed. */
export async function claimWebhookEvent(
	db: D1Database,
	eventId: string,
	type: string
): Promise<boolean> {
	const result = await db
		.prepare('INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)')
		.bind(eventId, type)
		.run();

	return (result.meta?.changes ?? 0) > 0;
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
