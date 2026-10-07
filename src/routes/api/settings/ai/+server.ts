import { json, type RequestHandler } from '@sveltejs/kit';
import {
	aiErrorResponse,
	deleteAiProvider,
	getAiProvider,
	INSTANCE_OWNER,
	saveAiProvider,
	type AiProviderInput
} from '$lib/server/ai-provider';
import { getAiInstructions, updateAiInstructions } from '$lib/server/draft-reply';
import { configuredEncryptionKey } from '$lib/server/secret-box';

/** The signed-in user's own AI provider, and what they fall back to without one. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const [own, instance, instructions] = await Promise.all([
		getAiProvider(db, locals.user.id),
		getAiProvider(db, INSTANCE_OWNER),
		getAiInstructions(db, locals.user.id)
	]);
	return json(
		{
			provider: own,
			// Enough to say what drafting falls back to — not the admin's URL or key hint.
			fallback: instance ? { kind: instance.kind, model: instance.model } : null,
			canStoreKeys: Boolean(configuredEncryptionKey(platform.env.ENCRYPTION_KEY)),
			instructions
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: AiProviderInput;
	try {
		body = (await request.json()) as AiProviderInput;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		return json({ provider: await saveAiProvider(db, platform.env, locals.user.id, body) });
	} catch (error) {
		return aiErrorResponse(error);
	}
};

/** Standing instructions for every draft, whichever provider writes it. */
export const PATCH: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { instructions?: unknown };
	try {
		body = (await request.json()) as { instructions?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (typeof body.instructions !== 'string') {
		return json({ error: 'Instructions must be text' }, { status: 400 });
	}

	try {
		return json({ instructions: await updateAiInstructions(db, locals.user.id, body.instructions) });
	} catch (error) {
		return aiErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	await deleteAiProvider(db, locals.user.id);
	return json({ ok: true });
};
