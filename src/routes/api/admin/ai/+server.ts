import { json, type RequestHandler } from '@sveltejs/kit';
import {
	aiErrorResponse,
	deleteAiProvider,
	getAiProvider,
	INSTANCE_OWNER,
	saveAiProvider,
	type AiProviderInput
} from '$lib/server/ai-provider';
import { configuredEncryptionKey } from '$lib/server/secret-box';

/** The instance-wide AI provider: everyone without their own key drafts with it. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	return json(
		{
			provider: await getAiProvider(db, INSTANCE_OWNER),
			workersAiAvailable: Boolean(platform.env.AI),
			canStoreKeys: Boolean(configuredEncryptionKey(platform.env.ENCRYPTION_KEY))
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	let body: AiProviderInput;
	try {
		body = (await request.json()) as AiProviderInput;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		return json({ provider: await saveAiProvider(db, platform.env, INSTANCE_OWNER, body) });
	} catch (error) {
		return aiErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	await deleteAiProvider(db, INSTANCE_OWNER);
	return json({ ok: true });
};
