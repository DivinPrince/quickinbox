import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { organizerBody, organizerJson, organizerSession } from '$lib/server/organizer-http';
export const GET: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const now = new Date().toISOString();
	const rows = await env.DB.prepare(
		`SELECT r.id, r.event_id, r.title, r.starts_at FROM calendar_reminders r
    JOIN calendar_events e ON e.id = r.event_id AND e.version = r.event_version
    WHERE r.user_id = ? AND r.due_at <= ? AND r.dismissed_at IS NULL AND e.cancelled = 0 AND e.ends_at > ? ORDER BY r.due_at LIMIT 10`
	)
		.bind(user.id, now, now)
		.all();
	return organizerJson({ reminders: rows.results });
};
export const POST: RequestHandler = async (event) => {
	const { env, user } = organizerSession(event);
	const raw = (await organizerBody(event.request)) as { id?: string };
	if (typeof raw?.id !== 'string' || raw.id.length > 200) throw error(400, 'Reminder required');
	await env.DB.prepare(
		'UPDATE calendar_reminders SET dismissed_at = ? WHERE id = ? AND user_id = ?'
	)
		.bind(new Date().toISOString(), raw.id, user.id)
		.run();
	return organizerJson({ ok: true });
};
