import { json, type RequestHandler } from '@sveltejs/kit';
import {
	hasPushSubscription,
	parsePushSubscription,
	removePushSubscription,
	savePushSubscription
} from '$lib/server/push-notifications';

function rejectCrossOrigin(request: Request, url: URL): Response | null {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 });
	}
	return null;
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const endpoint = url.searchParams.get('endpoint');
	if (!endpoint) return json({ error: 'Push endpoint is required' }, { status: 400 });
	return json({ registered: await hasPushSubscription(db, locals.user.id, endpoint) });
};

export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const crossOrigin = rejectCrossOrigin(request, url);
	if (crossOrigin) return crossOrigin;

	const body = await request.json().catch(() => null);
	const subscription = parsePushSubscription(body);
	if (!subscription) {
		return json({ error: 'Invalid push subscription' }, { status: 400 });
	}

	await savePushSubscription(
		db,
		locals.user.id,
		subscription,
		request.headers.get('user-agent')
	);
	return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, url, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const crossOrigin = rejectCrossOrigin(request, url);
	if (crossOrigin) return crossOrigin;

	const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
	if (typeof body?.endpoint !== 'string' || !body.endpoint.trim()) {
		return json({ error: 'Push endpoint is required' }, { status: 400 });
	}

	await removePushSubscription(db, locals.user.id, body.endpoint.trim());
	return json({ ok: true });
};
