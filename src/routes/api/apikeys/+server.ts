import { json, type RequestHandler } from '@sveltejs/kit';
import { createApiToken, isValidScope, listApiTokens, type ApiScope } from '$lib/server/api-tokens';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	// Belt and braces: the hook already keeps bearer tokens off this route, but a
	// key must never be able to mint or revoke keys even if that list changes.
	if (locals.apiToken) {
		return json({ error: 'Key management requires a signed-in session' }, { status: 403 });
	}

	return json({ tokens: await listApiTokens(db, locals.user.id) });
};

type CreateTokenBody = {
	name?: string;
	scopes?: ApiScope[];
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Belt and braces: the hook already keeps bearer tokens off this route, but a
	// key must never be able to mint or revoke keys even if that list changes.
	if (locals.apiToken) {
		return json({ error: 'Key management requires a signed-in session' }, { status: 403 });
	}

	const body = (await request.json().catch(() => null)) as CreateTokenBody | null;
	const scopes = body?.scopes ?? [];
	if (body && !isValidScope(scopes)) {
		return json({ error: 'Scopes must be a subset of mail:send, mail:read' }, { status: 400 });
	}

	const created = await createApiToken(db, locals.user.id, {
		name: body?.name,
		scopes: scopes.length ? scopes : undefined
	});

	// The raw token is only ever returned here — the table stores just its hash.
	return json({ ok: true, token: created.token, tokenMeta: created.summary }, { status: 201 });
};