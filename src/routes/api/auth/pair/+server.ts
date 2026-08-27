import { json, type RequestHandler } from '@sveltejs/kit';
import {
	checkRateLimit,
	deleteExpiredPairingCodes,
	redeemPairingCode
} from '$lib/server/auth';
import { PAIR_RATE_LIMIT_MAX, PAIR_RATE_LIMIT_WINDOW_SECONDS } from '$lib/server/constants';

const MAX_PAIR_BODY_BYTES = 4_096;

async function readBodyWithLimit(request: Request): Promise<string | null> {
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_PAIR_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

/**
 * Public endpoint: the mobile app exchanges a scanned one-time code for a
 * bearer token. Rate-limited per IP; codes are single-use and short-lived.
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const contentLength = Number(request.headers.get('Content-Length') ?? 0);
	if (Number.isFinite(contentLength) && contentLength > MAX_PAIR_BODY_BYTES) {
		return json({ error: 'Request body is too large' }, { status: 413 });
	}

	const ip = getClientAddress();
	const allowed = await checkRateLimit(
		db,
		`pair:${ip}`,
		PAIR_RATE_LIMIT_MAX,
		PAIR_RATE_LIMIT_WINDOW_SECONDS
	);
	if (!allowed) {
		return json(
			{ error: 'Too many attempts. Try again later.' },
			{
				status: 429,
				headers: { 'Retry-After': String(PAIR_RATE_LIMIT_WINDOW_SECONDS) }
			}
		);
	}

	let body: unknown;
	try {
		const rawBody = await readBodyWithLimit(request);
		if (rawBody === null) {
			return json({ error: 'Request body is too large' }, { status: 413 });
		}
		body = JSON.parse(rawBody);
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const input = body as { code?: unknown; deviceName?: unknown; platform?: unknown };
	if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(input.code)) {
		return json({ error: 'Pairing code is required' }, { status: 400 });
	}
	if (input.deviceName !== undefined && typeof input.deviceName !== 'string') {
		return json({ error: 'Device name must be text' }, { status: 400 });
	}
	if (typeof input.deviceName === 'string' && input.deviceName.length > 64) {
		return json({ error: 'Device name is too long' }, { status: 400 });
	}
	if (input.platform !== undefined && input.platform !== 'ios' && input.platform !== 'android') {
		return json({ error: 'Unsupported device platform' }, { status: 400 });
	}

	// Opportunistic cleanup; keeps the table small without a cron.
	await deleteExpiredPairingCodes(db);

	const result = await redeemPairingCode(db, input.code, {
		name: typeof input.deviceName === 'string' ? input.deviceName : '',
		platform: typeof input.platform === 'string' ? input.platform : undefined
	});

	if (!result) {
		return json({ error: 'Invalid or expired pairing code' }, { status: 401 });
	}

	return json(
		{ token: result.token, expiresAt: result.expiresAt },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
