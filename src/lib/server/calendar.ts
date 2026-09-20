import type { D1Database, D1PreparedStatement, R2Bucket } from '@cloudflare/workers-types';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { MailAddress, User } from '$lib/types';
import type { CalendarEvent, CalendarGuest } from '$lib/organizer/types';
import { eventTimes } from '$lib/organizer/dates';
import { resolveFromAddress, persistableAddressId } from './outbox';
import { getEmailForUser, insertEmail } from './mail-store';
import { invitationFile } from './calendar-ical';
import { prepareOutboundEmail, type OutboundMailInput } from './send-mail';
import { enqueueOutbound } from './durable-outbox';
import type { EmailProviderKind } from '$lib/types';
import { notifyUser, type PushNotificationEnv } from './push-notifications';

const field = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
export const eventInput = z.object({
	id: z.string().uuid().optional(),
	version: z.number().int().positive().optional(),
	title: field(180).refine((value) => value.length > 0 && !/[\r\n]/.test(value)),
	description: field(8000).default(''),
	location: field(500).default(''),
	startLocal: z.string().max(30),
	endLocal: z.string().max(30),
	timeZone: z.string().max(100),
	allDay: z.boolean().default(false),
	color: z
		.string()
		.regex(/^#[0-9a-f]{6}$/i)
		.default('#729681'),
	guests: z
		.array(
			z.object({
				email: z
					.string()
					.trim()
					.email()
					.max(254)
					.transform((v) => v.toLowerCase()),
				name: field(200).default('')
			})
		)
		.max(30)
		.default([]),
	fromAddressId: z.string().max(200).nullable().optional(),
	sourceEmailId: z.string().max(200).nullable().optional(),
	reminderMinutes: z.number().int().min(0).max(10080).nullable().default(10)
});

export async function getCalendarEvent(
	db: D1Database,
	userId: string,
	id: string
): Promise<CalendarEvent | null> {
	const row = await db
		.prepare('SELECT data_json FROM calendar_events WHERE user_id = ? AND id = ?')
		.bind(userId, id)
		.first<{ data_json: string }>();
	return row ? JSON.parse(row.data_json) : null;
}
export async function eventByUid(
	db: D1Database,
	userId: string,
	uid: string
): Promise<CalendarEvent | null> {
	const row = await db
		.prepare('SELECT data_json FROM calendar_events WHERE user_id = ? AND uid = ?')
		.bind(userId, uid)
		.first<{ data_json: string }>();
	return row ? JSON.parse(row.data_json) : null;
}
export async function listCalendarEvents(
	db: D1Database,
	userId: string,
	start: string,
	end: string
) {
	const a = Date.parse(start),
		b = Date.parse(end);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 370 * 86_400_000)
		throw error(400, 'Choose a calendar range of at most one year.');
	const rows = await db
		.prepare(
			`SELECT data_json FROM calendar_events WHERE user_id = ? AND cancelled = 0
    AND starts_at < ? AND ends_at > ? ORDER BY starts_at, id LIMIT 1001`
		)
		.bind(userId, new Date(b).toISOString(), new Date(a).toISOString())
		.all<{ data_json: string }>();
	return {
		events: rows.results.slice(0, 1000).map((row) => JSON.parse(row.data_json) as CalendarEvent),
		truncated: rows.results.length > 1000
	};
}

type NoticePayload = { outbound: OutboundMailInput; email: Parameters<typeof insertEmail>[1] };
export function calendarNotice(
	user: User,
	from: MailAddress,
	event: CalendarEvent,
	recipient: string,
	method: 'REQUEST' | 'CANCEL' | 'REPLY',
	reply?: CalendarGuest
): NoticePayload {
	const prefix =
		method === 'CANCEL'
			? 'Cancelled'
			: method === 'REPLY'
				? reply?.status === 'ACCEPTED'
					? 'Accepted'
					: reply?.status === 'DECLINED'
						? 'Declined'
						: 'Tentative'
				: 'Invitation';
	const subject = `${prefix}: ${event.title.replace(/[\r\n]+/g, ' ')}`;
	const when = event.allDay
		? `${event.startLocal} (all day)`
		: `${event.startLocal.replace('T', ' ')} – ${event.endLocal.replace('T', ' ')} (${event.timeZone})`;
	const text = `${subject}\n\n${when}${event.location ? `\nLocation: ${event.location}` : ''}\n\n${event.description}\n\n${method === 'REQUEST' ? 'Open the attached calendar invitation to respond.' : method === 'CANCEL' ? 'This event has been cancelled.' : `${from.address} responded ${reply?.status.toLowerCase()}.`}`;
	const bytes = new TextEncoder().encode(invitationFile(event, method, reply));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const outbound = prepareOutboundEmail({
		from: { ...from, signature: null },
		senderName: from.label || user.name,
		to: recipient,
		subject,
		text,
		attachments: [
			{
				filename: 'invite.ics',
				type: `text/calendar; charset=UTF-8; method=${method}`,
				content: btoa(binary),
				disposition: 'attachment'
			}
		]
	});
	return {
		outbound,
		email: {
			userId: user.id,
			direction: 'outbound',
			from: from.address,
			fromName: outbound.senderName,
			to: recipient,
			subject,
			bodyText: text,
			bodyHtml: outbound.html,
			domainId: from.domain_id,
			addressId: persistableAddressId(from.id),
			isRead: true,
			subjectMatch: false
		}
	};
}

/** One atomic D1 batch commits the event, its immutable notices, and reminder. */
export async function persistCalendarEvent(
	db: D1Database,
	userId: string,
	event: CalendarEvent,
	previous: CalendarEvent | null,
	notices: NoticePayload[] = []
): Promise<CalendarEvent> {
	const mutation = crypto.randomUUID();
	const statements: D1PreparedStatement[] = [
		previous
			? db
					.prepare(
						`UPDATE calendar_events SET title = ?, starts_at = ?, ends_at = ?,
    organizer_email = ?, data_json = ?, version = ?, sequence = ?, cancelled = ?, mutation_id = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND version = ?`
					)
					.bind(
						event.title,
						event.startsAt,
						event.endsAt,
						event.organizer.email,
						JSON.stringify(event),
						event.version,
						event.sequence,
						+event.cancelled,
						mutation,
						event.updatedAt,
						event.id,
						userId,
						previous.version
					)
			: db
					.prepare(
						`INSERT INTO calendar_events (id, user_id, uid, title, starts_at, ends_at, organizer_email, data_json, version, sequence,
      cancelled, mutation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						event.id,
						userId,
						event.uid,
						event.title,
						event.startsAt,
						event.endsAt,
						event.organizer.email,
						JSON.stringify(event),
						event.version,
						event.sequence,
						+event.cancelled,
						mutation,
						event.updatedAt,
						event.updatedAt
					)
	];
	for (const notice of notices)
		statements.push(
			db
				.prepare(
					`INSERT INTO calendar_notices
    (id, user_id, event_id, event_version, recipient, payload_json, created_at)
    SELECT ?, user_id, id, version, ?, ?, ? FROM calendar_events WHERE id = ? AND user_id = ? AND mutation_id = ?`
				)
				.bind(
					crypto.randomUUID(),
					String(notice.outbound.to),
					JSON.stringify(notice),
					event.updatedAt,
					event.id,
					userId,
					mutation
				)
		);
	const activeReminder =
		!event.cancelled &&
		event.response !== 'DECLINED' &&
		event.reminderMinutes !== null &&
		Date.parse(event.endsAt) > Date.now();
	const preserveReminder =
		activeReminder &&
		previous &&
		previous.startsAt === event.startsAt &&
		previous.reminderMinutes === event.reminderMinutes &&
		previous.response !== 'DECLINED';
	if (preserveReminder)
		statements.push(
			db
				.prepare(
					`UPDATE calendar_reminders SET event_version = ?, title = ? WHERE event_id = ? AND user_id = ?
    AND EXISTS (SELECT 1 FROM calendar_events WHERE id = ? AND mutation_id = ?)`
				)
				.bind(event.version, event.title, event.id, userId, event.id, mutation)
		);
	else
		statements.push(
			db
				.prepare(
					`DELETE FROM calendar_reminders WHERE event_id = ? AND user_id = ?
    AND EXISTS (SELECT 1 FROM calendar_events WHERE id = ? AND mutation_id = ?)`
				)
				.bind(event.id, userId, event.id, mutation)
		);
	if (activeReminder) {
		const due = new Date(
			Date.parse(event.startsAt) - event.reminderMinutes! * 60_000
		).toISOString();
		statements.push(
			db
				.prepare(
					`INSERT OR IGNORE INTO calendar_reminders (id, user_id, event_id, event_version, due_at, title, starts_at)
      SELECT ?, user_id, id, version, ?, title, starts_at FROM calendar_events WHERE id = ? AND user_id = ? AND mutation_id = ?`
				)
				.bind(crypto.randomUUID(), due, event.id, userId, mutation)
		);
	}
	let result;
	try {
		result = await db.batch(statements);
	} catch (cause) {
		if (String(cause).includes('UNIQUE'))
			throw error(409, 'This event already exists. Reload your calendar.');
		throw cause;
	}
	if (!result[0].meta.changes)
		throw error(409, 'This event changed in another tab. Reload before saving.');
	return event;
}

export async function saveCalendarEvent(db: D1Database, user: User, raw: unknown, id?: string) {
	const parsed = eventInput.safeParse(raw);
	if (!parsed.success)
		throw error(400, 'Check the event title, dates, guests, and reminder. Maximum 30 guests.');
	const input = parsed.data;
	const previous = id ? await getCalendarEvent(db, user.id, id) : null;
	if (id && !previous) throw error(404, 'Event not found');
	if (previous && (!previous.owned || previous.cancelled))
		throw error(403, 'Only the organizer can edit an active event.');
	if (previous && input.version !== previous.version)
		throw error(409, 'This event changed. Reload before saving.');
	let dates;
	try {
		dates = eventTimes(input.startLocal, input.endLocal, input.timeZone, input.allDay);
	} catch (cause) {
		throw error(400, cause instanceof Error ? cause.message : 'Invalid event dates');
	}
	let from: MailAddress;
	try {
		from = await resolveFromAddress(db, user, previous?.fromAddressId || input.fromAddressId);
	} catch {
		throw error(400, 'Choose one of your sending addresses in Settings.');
	}
	if (previous && from.address.toLowerCase() !== previous.organizer.email)
		throw error(409, 'The organizing email address is no longer available.');
	if (input.sourceEmailId && !(await getEmailForUser(db, user.id, input.sourceEmailId)))
		throw error(404, 'Source message not found');
	const changedTime =
		previous &&
		(previous.startsAt !== dates.startsAt ||
			previous.endsAt !== dates.endsAt ||
			previous.allDay !== input.allDay);
	const seen = new Set<string>([from.address.toLowerCase()]);
	const guests: CalendarGuest[] = input.guests
		.filter((g) => {
			if (seen.has(g.email)) return false;
			seen.add(g.email);
			return true;
		})
		.map((g) => ({
			...g,
			status:
				(!changedTime && previous?.guests.find((old) => old.email === g.email)?.status) ||
				'NEEDS-ACTION'
		}));
	const event: CalendarEvent = {
		...input,
		...dates,
		id: previous?.id ?? input.id ?? crypto.randomUUID(),
		uid: previous?.uid ?? `${crypto.randomUUID()}@quickinbox`,
		organizer: { email: from.address.toLowerCase(), name: from.label || user.name },
		guests,
		owned: true,
		fromAddressId: from.id,
		sourceEmailId: previous?.sourceEmailId ?? input.sourceEmailId ?? null,
		response: 'ACCEPTED',
		version: (previous?.version ?? 0) + 1,
		sequence: previous ? previous.sequence + 1 : 0,
		cancelled: false,
		updatedAt: new Date().toISOString()
	};
	const notices = guests.map((guest) => calendarNotice(user, from, event, guest.email, 'REQUEST'));
	for (const removed of previous?.guests.filter((g) => !seen.has(g.email)) ?? [])
		notices.push(
			calendarNotice(
				user,
				from,
				{ ...previous!, sequence: event.sequence, updatedAt: event.updatedAt, cancelled: true },
				removed.email,
				'CANCEL'
			)
		);
	return persistCalendarEvent(db, user.id, event, previous, notices);
}

export async function cancelCalendarEvent(db: D1Database, user: User, id: string, version: number) {
	const previous = await getCalendarEvent(db, user.id, id);
	if (!previous) throw error(404, 'Event not found');
	if (!previous.owned) throw error(403, 'Respond to the invitation to decline this event.');
	if (version !== previous.version)
		throw error(409, 'This event changed. Reload before cancelling.');
	if (previous.cancelled) return previous;
	const from = await resolveFromAddress(db, user, previous.fromAddressId);
	if (from.address.toLowerCase() !== previous.organizer.email)
		throw error(409, 'The organizing email address is no longer available.');
	const event = {
		...previous,
		version: previous.version + 1,
		sequence: previous.sequence + 1,
		cancelled: true,
		updatedAt: new Date().toISOString()
	};
	return persistCalendarEvent(
		db,
		user.id,
		event,
		previous,
		event.guests.map((guest) => calendarNotice(user, from, event, guest.email, 'CANCEL'))
	);
}

/** Bounded cron work; immutable payload + notice id makes handoff restart-safe. */
export async function flushCalendarNotices(
	env: { DB: D1Database; ATTACHMENTS: R2Bucket },
	provider: EmailProviderKind,
	userId?: string
) {
	const now = Date.now();
	const rows = await env.DB.prepare(
		`SELECT id, payload_json FROM calendar_notices WHERE state = 'pending' AND next_attempt_at <= ? AND lease_until < ?
    ${userId ? 'AND user_id = ?' : ''} ORDER BY created_at, rowid LIMIT 20`
	)
		.bind(now, now, ...(userId ? [userId] : []))
		.all<{ id: string; payload_json: string }>();
	for (const row of rows.results) {
		const claimed = await env.DB.prepare(
			`UPDATE calendar_notices SET lease_until = ?, attempts = attempts + 1
      WHERE id = ? AND state = 'pending' AND lease_until < ?`
		)
			.bind(now + 300_000, row.id, now)
			.run();
		if (!claimed.meta.changes) continue;
		try {
			const payload: NoticePayload = JSON.parse(row.payload_json);
			const job = await enqueueOutbound(
				env,
				provider,
				payload.outbound,
				payload.email,
				`calendar/${row.id}`
			);
			await env.DB.prepare(
				`UPDATE calendar_notices SET state = 'queued', email_id = ?, lease_until = 0, last_error = NULL WHERE id = ?`
			)
				.bind(job.id, row.id)
				.run();
		} catch {
			await env.DB.prepare(
				`UPDATE calendar_notices SET state = CASE WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
        next_attempt_at = ?, lease_until = 0, last_error = 'Invitation could not be added to Outbox. Retry from Calendar.' WHERE id = ?`
			)
				.bind(Date.now() + 300_000, row.id)
				.run();
		}
	}
}

export async function sendCalendarReminders(env: PushNotificationEnv) {
	const now = new Date().toISOString();
	const rows = await env.DB.prepare(
		`SELECT r.id, r.user_id, r.event_id, r.title, r.starts_at FROM calendar_reminders r
    JOIN calendar_events e ON e.id = r.event_id AND e.version = r.event_version
    WHERE r.due_at <= ? AND r.notified_at IS NULL AND r.dismissed_at IS NULL AND e.cancelled = 0 AND e.ends_at > ?
    ORDER BY r.due_at LIMIT 50`
	)
		.bind(now, now)
		.all<{ id: string; user_id: string; event_id: string; title: string; starts_at: string }>();
	for (const row of rows.results) {
		const claimed = await env.DB.prepare(
			`UPDATE calendar_reminders SET notified_at = ? WHERE id = ? AND notified_at IS NULL
      AND EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id AND e.version = event_version AND e.cancelled = 0)`
		)
			.bind(now, row.id)
			.run();
		if (!claimed.meta.changes) continue;
		await notifyUser(env, row.user_id, {
			title: row.title,
			body: 'Calendar reminder',
			tag: `calendar-${row.id}`,
			url: `/calendar?event=${encodeURIComponent(row.event_id)}`
		});
	}
}
