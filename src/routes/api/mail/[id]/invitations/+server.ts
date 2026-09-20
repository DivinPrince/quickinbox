import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readCalendarInvitation, respondToInvitation } from '$lib/server/calendar-invitations';
import { getEmailForUser } from '$lib/server/mail-store';
import { flushCalendarNotices } from '$lib/server/calendar';
import { getEmailProviderKind } from '$lib/server/context';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
import type { CalendarInvitation } from '$lib/organizer/types';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	if (!(await getEmailForUser(env.DB, user.id, event.params.id)))
		throw error(404, 'Message not found');
	const rows = await env.DB.prepare(
		`SELECT id FROM email_attachments WHERE email_id = ? AND (lower(filename) LIKE '%.ics' OR lower(content_type) LIKE 'text/calendar%') LIMIT 5`
	)
		.bind(event.params.id)
		.all<{ id: string }>();
	const invitations: CalendarInvitation[] = [],
		warnings: string[] = [];
	for (const row of rows.results) {
		try {
			invitations.push(
				(
					await readCalendarInvitation(
						env,
						user,
						event.params.id,
						row.id,
						event.url.searchParams.get('timeZone') || 'UTC'
					)
				).invitation
			);
		} catch (cause) {
			if (!isHttpError(cause)) throw cause;
			warnings.push(cause.body.message);
		}
	}
	return organizerJson({ invitations, warnings });
};
export const POST: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const saved = await respondToInvitation(
		env,
		user,
		event.params.id,
		await organizerBody(event.request)
	);
	event.platform?.ctx.waitUntil(
		flushCalendarNotices(env, getEmailProviderKind(event.platform), user.id)
	);
	return organizerJson({ event: saved });
};
