import type { D1Database } from '@cloudflare/workers-types';
import { createECDH } from 'node:crypto';
import webpush from 'web-push';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;
export const MAX_SUBSCRIPTIONS_PER_USER = 10;
const PUSH_REQUEST_TIMEOUT_MS = 10_000;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export type PushSubscriptionInput = {
	endpoint: string;
	expirationTime: number | null;
	keys: {
		p256dh: string;
		auth: string;
	};
};

export type PushNotificationEnv = {
	DB: D1Database;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	waitUntil?: (promise: Promise<void>) => void;
};

type StoredPushSubscription = {
	endpoint: string;
	p256dh: string;
	auth: string;
	expiration_time: number | null;
};

export type NewMailNotificationInput = {
	emailId: string;
	userId: string;
	from: string;
	subject: string;
};

export type NewMailPushPayload = {
	title: string;
	body: string;
	tag: string;
	url: string;
};

type VapidConfiguration = {
	publicKey: string;
	privateKey: string;
	subject: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: unknown): Uint8Array | null {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAX_KEY_LENGTH ||
		!BASE64URL.test(value)
	) {
		return null;
	}

	const unpadded = value.replace(/=+$/, '');
	if (unpadded.length % 4 === 1) return null;
	const base64 = unpadded.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

	try {
		const binary = atob(padded);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

function validPublicKey(value: unknown): value is string {
	const decoded = decodeBase64Url(value);
	return decoded?.byteLength === 65 && decoded[0] === 0x04;
}

function validAuthSecret(value: unknown): value is string {
	return decodeBase64Url(value)?.byteLength === 16;
}

function validVapidKeyPair(publicKey: string, privateKey: string): boolean {
	const publicBytes = decodeBase64Url(publicKey);
	const privateBytes = decodeBase64Url(privateKey);
	if (publicBytes?.byteLength !== 65 || publicBytes[0] !== 0x04 || privateBytes?.byteLength !== 32) {
		return false;
	}

	try {
		const ecdh = createECDH('prime256v1');
		ecdh.setPrivateKey(privateBytes);
		const derivedPublicKey = ecdh.getPublicKey();
		return (
			derivedPublicKey.byteLength === publicBytes.byteLength &&
			derivedPublicKey.every((byte, index) => byte === publicBytes[index])
		);
	} catch {
		return false;
	}
}

function validEndpoint(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const endpoint = value.trim();
	if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) return false;

	try {
		const url = new URL(endpoint);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

/** Treat browser subscription JSON as untrusted input before storing it. */
export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
	if (!isRecord(value) || typeof value.endpoint !== 'string' || !isRecord(value.keys)) {
		return null;
	}

	if (!validEndpoint(value.endpoint)) return null;
	const endpoint = value.endpoint.trim();

	if (!validPublicKey(value.keys.p256dh) || !validAuthSecret(value.keys.auth)) return null;

	const expirationTime = value.expirationTime ?? null;
	if (
		expirationTime !== null &&
		(typeof expirationTime !== 'number' || !Number.isFinite(expirationTime) || expirationTime < 0)
	) {
		return null;
	}

	return {
		endpoint,
		expirationTime,
		keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }
	};
}

export function readVapidConfiguration(
	env: Pick<PushNotificationEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>
): VapidConfiguration | null {
	const publicKey = env.VAPID_PUBLIC_KEY?.trim();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	const subject = env.VAPID_SUBJECT?.trim();
	if (!publicKey || !privateKey || !subject || !validVapidKeyPair(publicKey, privateKey)) return null;
	try {
		const subjectUrl = new URL(subject);
		if (subjectUrl.protocol !== 'mailto:' && subjectUrl.protocol !== 'https:') return null;
		if (subjectUrl.protocol === 'mailto:' && !subjectUrl.pathname.trim()) return null;
	} catch {
		return null;
	}
	return { publicKey, privateKey, subject };
}

export async function savePushSubscription(
	db: D1Database,
	userId: string,
	subscription: PushSubscriptionInput,
	userAgent?: string | null
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO push_subscriptions (
				id, user_id, endpoint, p256dh, auth, expiration_time, user_agent
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(endpoint) DO UPDATE SET
				user_id = excluded.user_id,
				p256dh = excluded.p256dh,
				auth = excluded.auth,
				expiration_time = excluded.expiration_time,
				user_agent = excluded.user_agent,
				updated_at = datetime('now')`
		)
		.bind(
			crypto.randomUUID(),
			userId,
			subscription.endpoint,
			subscription.keys.p256dh,
			subscription.keys.auth,
			subscription.expirationTime,
			userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null
		)
		.run();

	await capUserSubscriptions(db, userId, subscription.endpoint);
}

async function capUserSubscriptions(
	db: D1Database,
	userId: string,
	keepEndpoint: string
): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT id FROM push_subscriptions
			 WHERE user_id = ?
			 ORDER BY (endpoint = ?) DESC, updated_at DESC, rowid DESC`
		)
		.bind(userId, keepEndpoint)
		.all<{ id: string }>();

	const extraIds = results.slice(MAX_SUBSCRIPTIONS_PER_USER).map((row) => row.id);
	if (extraIds.length === 0) return;

	await db.batch(
		extraIds.map((id) => db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id))
	);
}

export async function hasPushSubscription(
	db: D1Database,
	userId: string,
	endpoint: string
): Promise<boolean> {
	if (!validEndpoint(endpoint)) return false;
	const row = await db
		.prepare('SELECT 1 AS registered FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
		.bind(userId, endpoint.trim())
		.first<{ registered: number }>();
	return row?.registered === 1;
}

export async function removePushSubscription(
	db: D1Database,
	userId: string,
	endpoint: string
): Promise<boolean> {
	const result = await db
		.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
		.bind(userId, endpoint)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

async function listPushSubscriptions(
	db: D1Database,
	userId: string
): Promise<StoredPushSubscription[]> {
	const { results } = await db
		.prepare(
			`SELECT endpoint, p256dh, auth, expiration_time
			 FROM push_subscriptions WHERE user_id = ?
			 ORDER BY updated_at DESC, rowid DESC
			 LIMIT ?`
		)
		.bind(userId, MAX_SUBSCRIPTIONS_PER_USER)
		.all<StoredPushSubscription>();
	return results;
}

async function removeDeadSubscriptions(db: D1Database, endpoints: string[]): Promise<void> {
	if (endpoints.length === 0) return;
	await db.batch(
		endpoints.map((endpoint) =>
			db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint)
		)
	);
}

function truncate(value: string, max: number): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function buildNewMailPayload(input: NewMailNotificationInput): NewMailPushPayload {
	return {
		title: truncate(input.subject || '(no subject)', 120) || '(no subject)',
		body: `From ${truncate(input.from || 'Unknown sender', 160) || 'Unknown sender'}`,
		tag: `quickinbox-${input.emailId}`,
		url: `/mail/${encodeURIComponent(input.emailId)}`
	};
}

export function pushErrorStatus(error: unknown): number | null {
	if (!isRecord(error) || typeof error.statusCode !== 'number') return null;
	return error.statusCode;
}

/**
 * Notify every browser registered to the recipient. Push failures never undo a
 * successfully stored email; expired endpoints are removed automatically.
 */
export async function notifyNewMail(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	try {
		await deliverNewMailNotification(env, input);
	} catch (error) {
		console.error(
			'Failed to deliver new-mail push notifications',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
}

/** Schedule best-effort delivery without holding up inbound-provider acknowledgement. */
export async function scheduleNewMailNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	const task = notifyNewMail(env, input);
	if (env.waitUntil) {
		env.waitUntil(task);
		return;
	}
	await task;
}

async function deliverNewMailNotification(
	env: PushNotificationEnv,
	input: NewMailNotificationInput
): Promise<void> {
	const vapid = readVapidConfiguration(env);
	if (!vapid) return;

	const subscriptions = await listPushSubscriptions(env.DB, input.userId);
	if (subscriptions.length === 0) return;

	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
	const payload = JSON.stringify(buildNewMailPayload(input));
	const deadEndpoints: string[] = [];

	await Promise.all(
		subscriptions.map(async (subscription) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: subscription.endpoint,
						expirationTime: subscription.expiration_time,
						keys: { p256dh: subscription.p256dh, auth: subscription.auth }
					},
					payload,
						{ TTL: 300, urgency: 'high', timeout: PUSH_REQUEST_TIMEOUT_MS }
				);
			} catch (error) {
				const status = pushErrorStatus(error);
				if (status === 404 || status === 410) {
					deadEndpoints.push(subscription.endpoint);
				} else {
					console.error(
						'Failed to send new-mail push notification',
						status ?? (error instanceof Error ? error.message : 'Unknown error')
					);
				}
			}
		})
	);

	await removeDeadSubscriptions(env.DB, deadEndpoints);
}
