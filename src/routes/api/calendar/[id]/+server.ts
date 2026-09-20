import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	cancelCalendarEvent,
	getCalendarEvent,
	saveCalendarEvent,
	flushCalendarNotices,
	persistCalendarEvent
} from '$lib/server/calendar';
import { getEmailProviderKind } from '$lib/server/context';
import { invitationFile } from '$lib/server/calendar-ical';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const saved = await getCalendarEvent(env.DB, user.id, event.params.id);
	if (!saved) throw error(404, 'Event not found');
	if (event.url.searchParams.get('download') === '1')
		return new Response(invitationFile(saved, 'PUBLISH'), {
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': 'attachment; filename="event.ics"',
				'Cache-Control': 'private, no-store'
			}
		});
	const notices = await env.DB.prepare(
		`SELECT n.id, n.recipient, n.state, n.email_id, n.last_error, e.status AS delivery_status
    FROM calendar_notices n LEFT JOIN emails e ON e.id = n.email_id WHERE n.event_id = ? AND n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`
	)
		.bind(saved.id, user.id)
		.all();
	return organizerJson({ event: saved, notices: notices.results });
};
export const PUT: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const saved = await saveCalendarEvent(
		env.DB,
		user,
		await organizerBody(event.request),
		event.params.id
	);
	event.platform?.ctx.waitUntil(
		flushCalendarNotices(env, getEmailProviderKind(event.platform), user.id)
	);
	return organizerJson({ event: saved });
};
export const DELETE: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const raw = (await organizerBody(event.request)) as { version?: number };
	if (!Number.isInteger(raw?.version)) throw error(400, 'Event version required');
	const saved = await cancelCalendarEvent(env.DB, user, event.params.id, raw.version!);
	event.platform?.ctx.waitUntil(
		flushCalendarNotices(env, getEmailProviderKind(event.platform), user.id)
	);
	return organizerJson({ event: saved });
};
export const PATCH: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const raw = (await organizerBody(event.request)) as {
		version?: number;
		reminderMinutes?: number | null;
		retryNotices?: boolean;
	};
	const previous = await getCalendarEvent(env.DB, user.id, event.params.id);
	if (!previous) throw error(404, 'Event not found');
	if (raw?.retryNotices === true) {
		await env.DB.prepare(
			`UPDATE calendar_notices SET state = 'pending', attempts = 0, next_attempt_at = 0 WHERE event_id = ? AND user_id = ? AND state = 'failed'`
		)
			.bind(previous.id, user.id)
			.run();
		event.platform?.ctx.waitUntil(
			flushCalendarNotices(env, getEmailProviderKind(event.platform), user.id)
		);
		return organizerJson({ ok: true });
	}
	if (raw?.version !== previous.version)
		throw error(409, 'Event changed. Reload before updating the reminder.');
	const minutes = raw.reminderMinutes;
	if (minutes !== null && (!Number.isInteger(minutes) || minutes! < 0 || minutes! > 10080))
		throw error(400, 'Invalid reminder');
	const saved = await persistCalendarEvent(
		env.DB,
		user.id,
		{
			...previous,
			reminderMinutes: minutes ?? null,
			version: previous.version + 1,
			updatedAt: new Date().toISOString()
		},
		previous
	);
	return organizerJson({ event: saved });
};
