import { json, type RequestHandler } from '@sveltejs/kit';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '$lib/i18n/locales';
import { setUserLocale } from '$lib/server/locale';

export const PATCH: RequestHandler = async ({ request, locals, platform, cookies }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { locale?: unknown };
	try {
		body = (await request.json()) as { locale?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (typeof body.locale !== 'string' || !isLocale(body.locale)) {
		return json({ error: 'Unknown locale' }, { status: 400 });
	}

	const locale = await setUserLocale(db, locals.user.id, body.locale);
	cookies.set(LOCALE_COOKIE, locale, {
		path: '/',
		maxAge: LOCALE_COOKIE_MAX_AGE,
		sameSite: 'lax',
		httpOnly: false
	});

	return json({ ok: true, locale });
};
