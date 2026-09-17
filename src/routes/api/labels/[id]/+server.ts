import { json, type RequestHandler } from '@sveltejs/kit';
import { bumpMailboxEpoch } from '$lib/server/mail-store';
import {
	deleteLabel,
	isLabelColor,
	MAX_LABEL_INSTRUCTIONS,
	MAX_LABEL_NAME,
	updateLabel
} from '$lib/server/labels';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as {
		name?: string;
		color?: string;
		autoEnabled?: boolean;
		autoInstructions?: string | null;
	};

	if (body.name !== undefined) {
		const name = body.name.trim();
		if (!name) return json({ error: 'Name is required' }, { status: 400 });
		if (name.length > MAX_LABEL_NAME) {
			return json({ error: `Name must be ${MAX_LABEL_NAME} characters or fewer` }, { status: 400 });
		}
	}
	if (body.color && !isLabelColor(body.color)) {
		return json({ error: 'Unknown color' }, { status: 400 });
	}
	if (body.autoInstructions && body.autoInstructions.length > MAX_LABEL_INSTRUCTIONS) {
		return json({ error: 'Auto-apply description is too long' }, { status: 400 });
	}

	const label = await updateLabel(db, locals.user.id, params.id!, {
		name: body.name,
		color: body.color,
		autoEnabled: body.autoEnabled,
		autoInstructions: body.autoInstructions
	});
	if (!label) return json({ error: 'Not found' }, { status: 404 });
	await bumpMailboxEpoch(db, locals.user.id);

	return json({ label });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const removed = await deleteLabel(db, locals.user.id, params.id!);
	if (!removed) return json({ error: 'Not found' }, { status: 404 });
	await bumpMailboxEpoch(db, locals.user.id);
	return json({ ok: true });
};
