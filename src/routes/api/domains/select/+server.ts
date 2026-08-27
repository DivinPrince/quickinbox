import { json, type RequestHandler } from '@sveltejs/kit';
import { DOMAIN_COOKIE } from '$lib/server/constants';
import { SESSION_DAYS } from '$lib/server/constants';

/** Persist which connected domain the dashboard is filtered to (null = all). */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as { domainId?: string | null };
	const domainId = body.domainId ?? null;

	if (domainId && !locals.domains.some((domain) => domain.id === domainId)) {
		return json({ error: 'Domain is not connected' }, { status: 400 });
	}

	if (domainId) {
		cookies.set(DOMAIN_COOKIE, domainId, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: SESSION_DAYS * 24 * 60 * 60
		});
	} else {
		cookies.delete(DOMAIN_COOKIE, { path: '/' });
	}

	return json({ ok: true, activeDomainId: domainId });
};
