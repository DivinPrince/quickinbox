import { json, type RequestHandler } from '@sveltejs/kit';
import { parseClassifyCursor } from '$lib/mail/classify-progress';
import { classifyNextExisting } from '$lib/server/classify';
import { countUnclassifiedInbound } from '$lib/server/mail-store';

function classifyEnabled(apiKey: string | undefined): boolean {
	return Boolean(apiKey?.trim());
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const enabled = classifyEnabled(platform.env.TYPESAFE_API_KEY);
	const remaining = await countUnclassifiedInbound(db, locals.user.id);
	return json(
		{ enabled, remaining },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const apiKey = platform.env.TYPESAFE_API_KEY?.trim();
	if (!apiKey) {
		return json({ error: 'Classification is not configured' }, { status: 400 });
	}

	let cursor = null;
	if (request.headers.get('content-type')?.includes('application/json')) {
		let body: { cursor?: unknown };
		try {
			body = (await request.json()) as { cursor?: unknown };
		} catch {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		if (body.cursor != null) {
			cursor = parseClassifyCursor(body.cursor);
			if (!cursor) return json({ error: 'Invalid cursor' }, { status: 400 });
		}
	}

	const step = await classifyNextExisting(db, apiKey, locals.user.id, cursor);
	return json(step);
};
