import type { RequestHandler } from './$types';
import { listCalendarEvents, saveCalendarEvent, flushCalendarNotices } from '$lib/server/calendar';
import { getEmailProviderKind } from '$lib/server/context';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	return organizerJson(
		await listCalendarEvents(
			env.DB,
			user.id,
			event.url.searchParams.get('start') || '',
			event.url.searchParams.get('end') || ''
		)
	);
};
export const POST: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const saved = await saveCalendarEvent(env.DB, user, await organizerBody(event.request));
	event.platform?.ctx.waitUntil(
		flushCalendarNotices(env, getEmailProviderKind(event.platform), user.id)
	);
	return organizerJson({ event: saved }, 201);
};
