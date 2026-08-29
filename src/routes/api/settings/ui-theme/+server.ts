import { json, type RequestHandler } from '@sveltejs/kit';
import { UI_THEME_COOKIE, UI_THEME_COOKIE_MAX_AGE } from '$lib/server/constants';
import { setUserUiTheme } from '$lib/server/ui-theme';
import { BUILTIN_THEME_IDS, parseThemeId } from '$lib/ui-theme/ids';

export const PATCH: RequestHandler = async ({ request, locals, platform, cookies }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { theme?: unknown };
	try {
		body = (await request.json()) as { theme?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (typeof body.theme !== 'string') {
		return json({ error: 'Theme is required' }, { status: 400 });
	}

	const theme = parseThemeId(body.theme, BUILTIN_THEME_IDS);
	if (theme !== body.theme) {
		return json({ error: 'Unknown theme' }, { status: 400 });
	}

	await setUserUiTheme(db, locals.user.id, theme);
	cookies.set(UI_THEME_COOKIE, theme, {
		path: '/',
		maxAge: UI_THEME_COOKIE_MAX_AGE,
		sameSite: 'lax',
		httpOnly: false
	});

	return json({ ok: true, theme });
};
