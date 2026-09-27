import { json, type RequestHandler } from '@sveltejs/kit';
import { aiErrorResponse } from '$lib/server/ai-provider';
import { draftReply } from '$lib/server/draft-reply';

/** Suggest a reply to one message. Returns text for the reply box; sends and stores nothing. */
export const POST: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		return json(await draftReply(db, platform.env, locals.user, params.id!));
	} catch (error) {
		return aiErrorResponse(error);
	}
};
