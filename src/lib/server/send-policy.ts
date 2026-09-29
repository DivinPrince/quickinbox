import type { D1Database } from '@cloudflare/workers-types';
import type { AuthMethod } from './api-access';

/**
 * Limits on sending with an API key or OAuth token — the REST API, the CLI and
 * both MCP servers. Browser and paired-phone sessions are never limited: these
 * exist to cap what a runaway or manipulated agent can do with a mailbox.
 */

export const DEFAULT_API_DAILY_SEND_LIMIT = 100;

export type ApiSendPolicy = {
	/** `API_SEND_ENABLED=false` stops every token-authenticated send at once. */
	enabled: boolean;
	/** Sends per user per UTC day; null when `API_DAILY_SEND_LIMIT=0`. */
	dailyLimit: number | null;
};

export function apiSendPolicy(
	env: { API_SEND_ENABLED?: string; API_DAILY_SEND_LIMIT?: string } | undefined
): ApiSendPolicy {
	const enabled = env?.API_SEND_ENABLED?.trim().toLowerCase() !== 'false';
	const raw = env?.API_DAILY_SEND_LIMIT?.trim();
	const limit = raw ? Number(raw) : DEFAULT_API_DAILY_SEND_LIMIT;
	// A malformed value keeps the default rather than silently lifting the cap.
	if (!Number.isInteger(limit) || limit < 0) {
		return { enabled, dailyLimit: DEFAULT_API_DAILY_SEND_LIMIT };
	}
	return { enabled, dailyLimit: limit === 0 ? null : limit };
}

/** The policy for this request's credential — undefined for people in a browser or app. */
export function apiSendPolicyFor(
	authMethod: AuthMethod | null,
	env: Parameters<typeof apiSendPolicy>[0]
): ApiSendPolicy | undefined {
	return authMethod === 'api_token' ? apiSendPolicy(env) : undefined;
}

export type SendPolicyErrorCode = 'api_sending_disabled' | 'daily_send_limit';

export class SendPolicyError extends Error {
	constructor(
		readonly code: SendPolicyErrorCode,
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'SendPolicyError';
	}
}

/** The UTC day an allowance is counted against, e.g. 2026-09-29. */
export function utcDay(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** Count one send against the day's allowance; false once it is used up. */
export async function claimDailySend(
	db: D1Database,
	userId: string,
	limit: number,
	day = utcDay()
): Promise<boolean> {
	// One statement, so two concurrent sends cannot both take the last slot.
	const claimed = await db
		.prepare(
			`INSERT INTO api_send_budget (user_id, day, send_count)
			 VALUES (?, ?, 1)
			 ON CONFLICT(user_id, day) DO UPDATE SET send_count = send_count + 1
			 WHERE send_count < ?
			 RETURNING send_count`
		)
		.bind(userId, day, limit)
		.first<{ send_count: number }>();
	return Boolean(claimed);
}

/** Give back a slot for a send the provider refused, so it never went out. */
export async function refundDailySend(db: D1Database, userId: string, day: string): Promise<void> {
	await db
		.prepare(
			`UPDATE api_send_budget SET send_count = send_count - 1
			 WHERE user_id = ? AND day = ? AND send_count > 0`
		)
		.bind(userId, day)
		.run();
}
