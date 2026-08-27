import { json, text, type RequestHandler } from '@sveltejs/kit';
import { getResendClient, getWebhookSecret } from '$lib/server/context';
import { claimWebhookEvent, handleResendWebhook, type ResendWebhookEvent } from '$lib/server/inbound';
import { verifyWebhookSignature } from '$lib/server/webhook';

/**
 * Resend webhook receiver — used when EMAIL_PROVIDER=resend.
 *
 * Point a webhook at https://<your-app>/api/webhooks/resend in the Resend
 * dashboard and subscribe to `email.received` plus the delivery events.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket) {
		return json({ error: 'Storage unavailable' }, { status: 503 });
	}

	const secret = getWebhookSecret(platform);
	if (!secret) {
		console.error('Rejected webhook: RESEND_WEBHOOK_SECRET is not configured');
		return json({ error: 'Webhook secret not configured' }, { status: 503 });
	}

	// Must be the raw body — parsing first would invalidate the signature.
	const rawBody = await request.text();
	const verified = await verifyWebhookSignature(request.headers, rawBody, secret);
	if (!verified.ok) {
		console.warn('Rejected webhook signature:', verified.reason);
		return json({ error: 'Invalid signature' }, { status: 401 });
	}

	let event: ResendWebhookEvent;
	try {
		event = JSON.parse(rawBody) as ResendWebhookEvent;
	} catch {
		return json({ error: 'Invalid JSON payload' }, { status: 400 });
	}

	if (!event?.type) {
		return json({ error: 'Missing event type' }, { status: 400 });
	}

	const eventId =
		request.headers.get('svix-id') ?? request.headers.get('webhook-id') ?? crypto.randomUUID();

	// Resend retries; only the first claim of an id does the work.
	const claimed = await claimWebhookEvent(db, eventId, event.type);
	if (!claimed) {
		return text('Duplicate event ignored', { status: 200 });
	}

	try {
		const client = getResendClient(platform);
		const outcome = await handleResendWebhook(
			event,
			{
				DB: db,
				ATTACHMENTS: bucket,
				VAPID_PUBLIC_KEY: platform?.env.VAPID_PUBLIC_KEY,
				VAPID_PRIVATE_KEY: platform?.env.VAPID_PRIVATE_KEY,
				VAPID_SUBJECT: platform?.env.VAPID_SUBJECT,
				waitUntil: platform?.ctx ? (promise) => platform.ctx.waitUntil(promise) : undefined
			},
			client
		);
		return json({ ok: true, ...outcome });
	} catch (error) {
		// Release the claim so Resend's retry can succeed.
		await db.prepare('DELETE FROM webhook_events WHERE id = ?').bind(eventId).run();
		console.error('Webhook handling failed', event.type, error);
		return json(
			{ error: error instanceof Error ? error.message : 'Webhook handling failed' },
			{ status: 500 }
		);
	}
};
