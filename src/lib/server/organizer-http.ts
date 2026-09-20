import { error, json, type RequestEvent } from '@sveltejs/kit';

export function organizerSession({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user || !platform?.env.DB) throw error(401, 'Sign in to continue');
	return { user: locals.user, env: platform.env };
}

/** Bound bodies before decoding, including requests without Content-Length. */
export async function organizerBody(request: Request, limit = 64 * 1024): Promise<unknown> {
	if (
		request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
	)
		throw error(415, 'Send application/json');
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin)
		throw error(403, 'Cross-origin writes are not allowed');
	if (!request.body) throw error(400, 'A request body is required');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw error(413, 'Request is too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw error(400, 'Invalid JSON');
	}
}

export function organizerJson(data: unknown, status = 200) {
	return json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
