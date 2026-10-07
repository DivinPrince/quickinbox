import { json, type RequestHandler } from '@sveltejs/kit';
import { aiErrorResponse, resolveInstanceAiProvider, testAiProvider } from '$lib/server/ai-provider';

/** Send a tiny request through the instance provider. */
export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	try {
		const provider = await resolveInstanceAiProvider(db, platform.env);
		if (!provider) {
			return json({ error: 'No instance AI provider is set up' }, { status: 400 });
		}
		const reply = await testAiProvider(platform.env, provider);
		return json({ ok: true, model: provider.model, reply });
	} catch (error) {
		return aiErrorResponse(error);
	}
};
