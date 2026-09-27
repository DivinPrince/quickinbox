import { json, type RequestHandler } from '@sveltejs/kit';
import { aiErrorResponse, resolveAiProvider, testAiProvider } from '$lib/server/ai-provider';

/** Send a tiny request through whichever provider drafting would use for this user. */
export const POST: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const provider = await resolveAiProvider(db, platform.env, locals.user.id);
		if (!provider) {
			return json({ error: 'No AI provider is set up' }, { status: 400 });
		}
		const reply = await testAiProvider(platform.env, provider);
		return json({ ok: true, source: provider.source, model: provider.model, reply });
	} catch (error) {
		return aiErrorResponse(error);
	}
};
