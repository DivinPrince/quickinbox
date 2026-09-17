import { json, type RequestHandler } from '@sveltejs/kit';
import { bumpMailboxEpoch } from '$lib/server/mail-store';
import { createLabel, listLabels, parseLabelWriteBody } from '$lib/server/labels';

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

	const parsed = parseLabelWriteBody(await request.json().catch(() => null), 'create');
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400 });
	}

	const label = await createLabel(db, locals.user.id, {
		name: parsed.fields.name ?? '',
		color: parsed.fields.color,
		autoEnabled: parsed.fields.autoEnabled,
		autoInstructions: parsed.fields.autoInstructions
	});
	await bumpMailboxEpoch(db, locals.user.id);

	return json({ label }, { status: 201 });
};
