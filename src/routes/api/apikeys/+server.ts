import { json, type RequestHandler } from '@sveltejs/kit';
import { createApiToken, listApiTokens, parseScopes, type ApiScope } from '$lib/server/api-tokens';

export const GET: RequestHandler = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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

	const body = (await request.json().catch(() => null)) as CreateTokenBody | null;
	const scopes = body?.scopes ?? [];
	const parsed = scopes.length === 0 ? null : parseScopes(scopes, locals.user.is_admin);
	if (body && !parsed) {
		return json(
			{
				error: locals.user.is_admin
					? 'Scopes must be a subset of mail:send, mail:read, admin'
					: 'Scopes must be a subset of mail:send, mail:read'
			},
			{ status: 400 }
		);
	}

	const created = await createApiToken(db, locals.user.id, {
		name: body?.name,
		scopes: parsed ?? undefined
	});

	// The raw token is only ever returned here — the table stores just its hash.
	return json({ ok: true, token: created.token, tokenMeta: created.summary }, { status: 201 });
};
