import { json, type RequestHandler } from '@sveltejs/kit';
import { getResendClient } from '$lib/server/context';
import { disconnectDomain, getDomain, setCatchallUser, upsertDomain } from '$lib/server/domains';
import { ResendError } from '$lib/server/resend';

/** PATCH — set the catch-all owner or re-sync DNS status from Resend. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const domain = await getDomain(db, params.id!);
	if (!domain) {
		return json({ error: 'Domain not connected' }, { status: 404 });
	}

	const body = (await request.json()) as {
		catchallUserId?: string | null;
		refresh?: boolean;
	};

	if (body.refresh) {
		try {
			const client = getResendClient(platform);
			const remote = await client.getDomain(domain.id);
			return json({ domain: await upsertDomain(db, remote) });
		} catch (error) {
			return json(
				{ error: error instanceof ResendError ? error.message : 'Failed to refresh domain' },
				{ status: 502 }
			);
		}
	}

	if (body.catchallUserId !== undefined) {
		await setCatchallUser(db, domain.id, body.catchallUserId || null);
	}

	return json({ domain: await getDomain(db, domain.id) });
};

/** DELETE — stop using the domain here. The domain stays in Resend. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	await disconnectDomain(db, params.id!);
	return json({ ok: true });
};
