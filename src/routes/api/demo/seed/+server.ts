import { json, type RequestHandler } from '@sveltejs/kit';
import { isDemoResendKey, resolveDemoDomainName } from '$lib/server/demo-resend';
import { seedDemoMailbox } from '$lib/server/demo-seed';

/** Local demo helper — disabled unless RESEND_API_KEY=demo_local. */
export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!isDemoResendKey(platform?.env.RESEND_API_KEY)) {
		return json({ error: 'Demo seed is only available with RESEND_API_KEY=demo_local' }, { status: 404 });
	}

	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const domain = locals.domains[0];
	if (!domain) {
		return json({ error: 'Connect a domain first' }, { status: 400 });
	}

	const mailbox =
		locals.addresses.find((address) => address.is_default)?.address ??
		locals.addresses[0]?.address ??
		user.email;

	const result = await seedDemoMailbox(
		platform!.env.DB,
		user.id,
		domain.id,
		resolveDemoDomainName(domain.name || platform?.env.DEMO_MAIL_DOMAIN),
		mailbox
	);
	return json({ ok: true, ...result });
};
