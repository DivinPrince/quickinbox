import type { D1Database } from '@cloudflare/workers-types';

/**
 * At-most-once sending. A send that carries an Idempotency-Key is recorded
 * before the provider is called, so retrying the same request returns the
 * original result instead of emailing twice. Cloudflare's send binding has no
 * idempotency of its own, and Resend's covers only its API call — not our
 * Sent-folder write.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** UUIDs and similar opaque keys; long enough that collisions are the caller's intent. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export type SendAttemptErrorCode =
	| 'idempotency_conflict'
	| 'send_in_progress'
	| 'send_outcome_unknown'
	| 'already_sent';

export class SendAttemptError extends Error {
	readonly status = 409;

	constructor(
		readonly code: SendAttemptErrorCode,
		message: string
	) {
		super(message);
		this.name = 'SendAttemptError';
	}
}

export type SendAttempt =
	| { kind: 'claimed'; id: string }
	| { kind: 'replay'; id: string; emailId: string; providerId: string };

/** The header's key, `undefined` when absent, or `null` when malformed. */
export function readIdempotencyKey(request: Request): string | null | undefined {
	const value = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
	if (!value) return undefined;
	return IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null;
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Take ownership of a send, or learn that it already happened. Throws
 * SendAttemptError when the key is in flight or was used for other content.
 */
export async function claimSendAttempt(
	db: D1Database,
	userId: string,
	key: string,
	requestHash: string
): Promise<SendAttempt> {
	const id = await sha256Hex(`${userId}\u0000${key}`);

	const inserted = await db
		.prepare(
			`INSERT INTO send_attempts (id, user_id, request_hash, status)
			 VALUES (?, ?, ?, 'sending')
			 ON CONFLICT(id) DO NOTHING
			 RETURNING id`
		)
		.bind(id, userId, requestHash)
		.first<{ id: string }>();
	if (inserted) return { kind: 'claimed', id };

	// A failed send never reached anyone, so its key may be reused — even for
	// edited content, which is what a person does after a rejected recipient.
	const reclaimed = await db
		.prepare(
			`UPDATE send_attempts
			 SET status = 'sending', request_hash = ?, error = NULL, updated_at = datetime('now')
			 WHERE id = ? AND user_id = ? AND status = 'failed'
			 RETURNING id`
		)
		.bind(requestHash, id, userId)
		.first<{ id: string }>();
	if (reclaimed) return { kind: 'claimed', id };

	const existing = await db
		.prepare(
			`SELECT status, request_hash, email_id, provider_id, error
			 FROM send_attempts WHERE id = ? AND user_id = ?`
		)
		.bind(id, userId)
		.first<{
			status: 'sending' | 'sent' | 'failed';
			request_hash: string;
			email_id: string | null;
			provider_id: string | null;
			error: string | null;
		}>();

	if (existing && existing.request_hash !== requestHash) {
		throw new SendAttemptError(
			'idempotency_conflict',
			'This Idempotency-Key was already used for a different message'
		);
	}
	if (existing?.status === 'sent' && existing.email_id && existing.provider_id) {
		return { kind: 'replay', id, emailId: existing.email_id, providerId: existing.provider_id };
	}
	// Still `sending` with a provider id: the mail went out and only saving it to
	// Sent is outstanding (or failed). Sending again would duplicate it.
	if (existing?.provider_id) {
		throw new SendAttemptError('already_sent', 'This message was already sent.');
	}
	// Still `sending` with an error: the provider failed in a way that does not
	// rule out delivery, such as a lost response.
	if (existing?.error) {
		throw new SendAttemptError(
			'send_outcome_unknown',
			"We couldn't confirm whether this message was sent. Check Sent, or with the recipient, before sending it again."
		);
	}
	throw new SendAttemptError(
		'send_in_progress',
		'This message is already being sent. Check Sent before trying again.'
	);
}

export async function completeSendAttempt(
	db: D1Database,
	id: string,
	emailId: string,
	providerId: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE send_attempts
			 SET status = 'sent', email_id = ?, provider_id = ?, error = NULL, updated_at = datetime('now')
			 WHERE id = ?`
		)
		.bind(emailId, providerId, id)
		.run();
}

/** The provider accepted the message: from here on a retry must never send again. */
export async function recordProviderAccepted(
	db: D1Database,
	id: string,
	providerId: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE send_attempts SET provider_id = ?, updated_at = datetime('now')
			 WHERE id = ? AND status = 'sending'`
		)
		.bind(providerId, id)
		.run();
}

/**
 * The provider failed without saying the message was refused, so it may have
 * gone out. The attempt stays claimed; a retry is told the outcome is unknown.
 */
export async function markSendUncertain(db: D1Database, id: string, error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : 'Send failed';
	await db
		.prepare(
			`UPDATE send_attempts SET error = ?, updated_at = datetime('now')
			 WHERE id = ? AND status = 'sending'`
		)
		.bind(message.slice(0, 2000) || 'Send failed', id)
		.run();
}

/** The message certainly did not go out, so its key may be used again. */
export async function failSendAttempt(db: D1Database, id: string, error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : 'Send failed';
	await db
		.prepare(
			`UPDATE send_attempts
			 SET status = 'failed', error = ?, updated_at = datetime('now')
			 WHERE id = ? AND status = 'sending'`
		)
		.bind(message.slice(0, 2000), id)
		.run();
}
