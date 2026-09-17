import { json, type RequestHandler } from '@sveltejs/kit';
import { bumpMailboxEpoch } from '$lib/server/mail-store';
import {
	createLabel,
	deleteLabel,
	isLabelColor,
	listLabels,
	MAX_LABEL_INSTRUCTIONS,
	MAX_LABEL_NAME,
	updateLabel
} from '$lib/server/labels';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return json({ labels: await listLabels(db, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
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

	const name = body.name?.trim() ?? '';
	if (!name) return json({ error: 'Name is required' }, { status: 400 });
	if (name.length > MAX_LABEL_NAME) {
		return json({ error: `Name must be ${MAX_LABEL_NAME} characters or fewer` }, { status: 400 });
	}
	if (body.color && !isLabelColor(body.color)) {
		return json({ error: 'Unknown color' }, { status: 400 });
	}
	if (body.autoInstructions && body.autoInstructions.length > MAX_LABEL_INSTRUCTIONS) {
		return json({ error: 'Auto-apply description is too long' }, { status: 400 });
	}

	const label = await createLabel(db, locals.user.id, {
		name,
		color: body.color,
		autoEnabled: body.autoEnabled,
		autoInstructions: body.autoInstructions
	});
	await bumpMailboxEpoch(db, locals.user.id);

	return json({ label }, { status: 201 });
};
