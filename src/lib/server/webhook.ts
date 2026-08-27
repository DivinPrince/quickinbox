/**
 * Standard Webhooks (Svix) signature verification, implemented with Web Crypto
 * so it works on Workers without the Node SDK.
 *
 * Resend signs every webhook with `svix-id`, `svix-timestamp` and
 * `svix-signature`. The signed content is `${id}.${timestamp}.${rawBody}` and
 * the secret is base64 after the `whsec_` prefix.
 *
 * Docs: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */

const TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerifyResult =
	| { ok: true }
	| { ok: false; reason: string };

type HeaderReader = { get(name: string): string | null };

function readHeader(headers: HeaderReader, name: string): string | null {
	// Resend sends the `svix-*` names; the spec also allows `webhook-*`.
	return headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`);
}

export async function verifyWebhookSignature(
	headers: HeaderReader,
	rawBody: string,
	secret: string
): Promise<WebhookVerifyResult> {
	if (!secret) {
		return { ok: false, reason: 'RESEND_WEBHOOK_SECRET is not configured' };
	}

	const id = readHeader(headers, 'id');
	const timestamp = readHeader(headers, 'timestamp');
	const signature = readHeader(headers, 'signature');

	if (!id || !timestamp || !signature) {
		return { ok: false, reason: 'Missing signature headers' };
	}

	const timestampSeconds = Number(timestamp);
	if (!Number.isFinite(timestampSeconds)) {
		return { ok: false, reason: 'Invalid timestamp header' };
	}

	const drift = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
	if (drift > TOLERANCE_SECONDS) {
		return { ok: false, reason: 'Timestamp outside tolerance window' };
	}

	const key = await crypto.subtle.importKey(
		'raw',
		base64ToBytes(secret.replace(/^whsec_/, '')) as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const signed = `${id}.${timestamp}.${rawBody}`;
	const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
	const expected = bytesToBase64(new Uint8Array(digest));

	// The header holds a space-separated list of `v1,<signature>` entries so
	// secrets can be rotated without dropping messages.
	for (const entry of signature.split(' ')) {
		const [version, value] = entry.split(',');
		if (version !== 'v1' || !value) continue;
		if (timingSafeEqual(value, expected)) {
			return { ok: true };
		}
	}

	return { ok: false, reason: 'No matching signature' };
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
