import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testStore } from './testing/store';
import {
	saveCalendarEvent,
	cancelCalendarEvent,
	getCalendarEvent,
	listCalendarEvents,
	flushCalendarNotices,
	sendCalendarReminders,
	persistCalendarEvent
} from './calendar';
import { invitationFile, parseInvitation } from './calendar-ical';
import { readCalendarInvitation, respondToInvitation } from './calendar-invitations';
import { eventTimes } from '$lib/organizer/dates';
import { flushOutbox } from './durable-outbox';
import { insertEmail } from './mail-store';
import { insertAttachmentBytes } from './attachments';
import type { CalendarEvent } from '$lib/organizer/types';
import type { EmailProvider } from './email-provider';
import { handleCloudflareInbound } from './cloudflare-inbound';
const input = {
	title: 'Project planning',
	description: 'Line one\nLine two, with semicolons; and unicode ✉',
	location: 'Room 1',
	startLocal: '2030-06-20T09:00',
	endLocal: '2030-06-20T10:00',
	timeZone: 'America/Chicago',
	allDay: false,
	guests: [{ email: 'guest@example.test', name: 'Guest' }],
	reminderMinutes: 10
};
const count = (s: ReturnType<typeof testStore>, table: string) =>
	(s.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('received MIME calendar parts survive ingestion and expose a valid invitation', async () => {
	const s = testStore();
	const template = await saveCalendarEvent(s.db, s.user, { ...input, guests: [] });
	const event = {
		...template,
		uid: 'mime-invitation',
		organizer: { email: 'host@example.test', name: 'Host' },
		guests: [{ email: s.user.email, name: 'Me', status: 'NEEDS-ACTION' as const }]
	};
	const raw = [
		'From: Host <host@example.test>',
		`To: ${s.user.email}`,
		'Subject: Calendar test',
		'Message-ID: <calendar-test@example.test>',
		'MIME-Version: 1.0',
		'Content-Type: multipart/alternative; boundary="calendar-part"',
		'',
		'--calendar-part',
		'Content-Type: text/plain; charset=utf-8',
		'',
		'Please join us.',
		'--calendar-part',
		'Content-Type: text/calendar; charset=utf-8; method=REQUEST',
		'Content-Disposition: inline; filename="invite.ics"',
		'',
		invitationFile(event, 'REQUEST'),
		'--calendar-part--',
		''
	].join('\r\n');
	await handleCloudflareInbound(
		{
			from: 'host@example.test',
			to: s.user.email,
			headers: new Headers(),
			raw: new Response(raw).body!,
			setReject(reason) {
				throw new Error(reason);
			}
		},
		s.env
	);
	const attachment = s.sqlite.query('SELECT id, email_id FROM email_attachments').get() as {
		id: string;
		email_id: string;
	};
	assert.ok(attachment);
	const read = await readCalendarInvitation(s.env, s.user, attachment.email_id, attachment.id);
	assert.equal(read.invitation.canRespond, true);
	assert.equal(read.invitation.event.uid, 'mime-invitation');
});

test('calendar stores UTC instants, isolates owners, and atomically creates notices/reminders', async () => {
	const s = testStore();
	const event = await saveCalendarEvent(s.db, s.user, input);
	assert.equal(event.startsAt, '2030-06-20T14:00:00.000Z');
	assert.equal(event.endsAt, '2030-06-20T15:00:00.000Z');
	assert.equal(count(s, 'calendar_notices'), 1);
	assert.equal(count(s, 'calendar_reminders'), 1);
	assert.equal(await getCalendarEvent(s.db, 'user-2', event.id), null);
	assert.equal(
		(await listCalendarEvents(s.db, 'user-2', '2030-06-01', '2030-07-01')).events.length,
		0
	);
	assert.equal(
		(await listCalendarEvents(s.db, s.user.id, '2030-06-20T14:30:00Z', '2030-06-21')).events.length,
		1
	);
	await assert.rejects(
		saveCalendarEvent(s.db, { ...s.user, id: 'user-2' }, { ...input, version: 1 }, event.id),
		{ status: 404 }
	);
	await assert.rejects(saveCalendarEvent(s.db, s.user, { ...input, version: 2 }, event.id), {
		status: 409
	});
	s.faults.sql = (sql) => {
		if (sql.startsWith('INSERT INTO calendar_notices')) throw new Error('D1 failure');
	};
	await assert.rejects(
		saveCalendarEvent(s.db, s.user, { ...input, title: 'Rollback', version: 1 }, event.id)
	);
	s.faults.sql = undefined;
	assert.equal((await getCalendarEvent(s.db, s.user.id, event.id))?.title, input.title);
	assert.equal(count(s, 'calendar_notices'), 1);
});

test('time validation handles DST and exclusive all-day end dates', () => {
	assert.equal(
		eventTimes('2030-01-20T09:00', '2030-01-20T10:00', 'America/Chicago', false).startsAt,
		'2030-01-20T15:00:00.000Z'
	);
	assert.throws(
		() => eventTimes('2026-03-08T02:30', '2026-03-08T04:00', 'America/Chicago', false),
		/daylight/
	);
	assert.throws(
		() => eventTimes('2026-11-01T01:30', '2026-11-01T03:00', 'America/Chicago', false),
		/daylight/
	);
	const day = eventTimes('2026-03-08', '2026-03-09', 'America/Chicago', true);
	assert.equal(Date.parse(day.endsAt) - Date.parse(day.startsAt), 23 * 3600_000);
	assert.throws(() => eventTimes('2026-01-02', '2026-01-01', 'UTC', true));
	assert.throws(() => eventTimes('2026-01-01', '2026-01-02', 'Invalid/Zone', true));
});
test('simultaneous event edits create invitations only for the winning revision', async () => {
	const s = testStore();
	const event = await saveCalendarEvent(s.db, s.user, input);
	const outcomes = await Promise.allSettled(
		['First', 'Second'].map((title) =>
			saveCalendarEvent(s.db, s.user, { ...input, title, version: event.version }, event.id)
		)
	);
	assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
	assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
	assert.equal(count(s, 'calendar_notices'), 2);
	assert.equal((await getCalendarEvent(s.db, s.user.id, event.id))?.version, 2);
});

test('iCalendar roundtrips dates, text escapes, guests, and cancellations', async () => {
	const s = testStore();
	const event = await saveCalendarEvent(s.db, s.user, input);
	const source = invitationFile(event, 'REQUEST');
	const parsed = parseInvitation(source);
	assert.equal(parsed.method, 'REQUEST');
	assert.equal(parsed.event.uid, event.uid);
	assert.equal(parsed.event.startsAt, event.startsAt);
	assert.equal(parsed.event.description, event.description);
	assert.equal(parsed.event.organizer.email, s.user.email);
	assert.equal(parsed.event.guests[0].email, 'guest@example.test');
	assert.equal(parseInvitation(invitationFile(event, 'CANCEL')).event.cancelled, true);
	const allDay = await saveCalendarEvent(s.db, s.user, {
		...input,
		startLocal: '2030-06-20',
		endLocal: '2030-06-21',
		allDay: true,
		guests: []
	});
	const a = parseInvitation(invitationFile(allDay, 'PUBLISH'), 'America/Chicago').event;
	assert.equal(a.startLocal, '2030-06-20');
	assert.equal(a.endLocal, '2030-06-21');
	assert.equal(a.allDay, true);
});

test('invitation parser rejects recurring series and unsafe structures; resolves IANA zones', async () => {
	const s = testStore();
	const event = await saveCalendarEvent(s.db, s.user, input);
	const source = invitationFile(event, 'REQUEST');
	assert.throws(
		() => parseInvitation(source.replace('END:VEVENT', 'RRULE:FREQ=DAILY\r\nEND:VEVENT')),
		/Recurring/
	);
	assert.throws(() => parseInvitation('BEGIN:VCALENDAR\n'.repeat(20)), /deeply/);
	assert.throws(() => parseInvitation('x'.repeat(270_000)), /large/);
	const iana = source
		.replace(/DTSTART:[^\r]+/, 'DTSTART;TZID=America/Chicago:20300620T090000')
		.replace(/DTEND:[^\r]+/, 'DTEND;TZID=America/Chicago:20300620T100000');
	assert.equal(parseInvitation(iana).event.startsAt, event.startsAt);
	const embedded = iana
		.replaceAll('America/Chicago', 'Custom/Zone')
		.replace(
			'BEGIN:VEVENT',
			'BEGIN:VTIMEZONE\r\nTZID:Custom/Zone\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT'
		);
	assert.equal(parseInvitation(embedded).event.startsAt, event.startsAt);
});

test('updates notify remaining guests and cancel removed guests; cancellation clears reminders', async () => {
	const s = testStore();
	const original = await saveCalendarEvent(s.db, s.user, input);
	const updated = await saveCalendarEvent(
		s.db,
		s.user,
		{ ...input, version: original.version, guests: [{ email: 'new@example.test' }] },
		original.id
	);
	assert.equal(updated.sequence, 1);
	assert.equal(count(s, 'calendar_notices'), 3);
	const notices = s.sqlite.query('SELECT payload_json FROM calendar_notices').all() as {
		payload_json: string;
	}[];
	assert.match(notices[2].payload_json, /Cancelled:/);
	await cancelCalendarEvent(s.db, s.user, original.id, updated.version);
	assert.equal(count(s, 'calendar_reminders'), 0);
	assert.equal(
		(await listCalendarEvents(s.db, s.user.id, '2030-06-01', '2030-07-01')).events.length,
		0
	);
	assert.equal(count(s, 'calendar_notices'), 4);
});

test('notice handoff survives failure after outbox reservation without duplicate sends', async () => {
	const s = testStore();
	await saveCalendarEvent(s.db, s.user, input);
	let sends = 0;
	const provider: EmailProvider = {
		kind: 'resend',
		async send(mail) {
			sends++;
			assert.match(mail.attachments![0].type, /method=REQUEST/);
			return { providerId: `provider-${sends}` };
		},
		async listDomains() {
			return [];
		},
		async getDomain() {
			throw new Error('unused');
		}
	};
	s.faults.sql = (sql) => {
		if (sql.startsWith("UPDATE calendar_notices SET state = 'queued'"))
			throw new Error('worker died after enqueue');
	};
	await flushCalendarNotices(s.env, provider.kind);
	assert.equal(count(s, 'outbox_jobs'), 1);
	s.faults.sql = undefined;
	s.sqlite.exec('UPDATE calendar_notices SET next_attempt_at = 0');
	await flushCalendarNotices(s.env, provider.kind);
	await flushOutbox(s.env, provider);
	await flushCalendarNotices(s.env, provider.kind);
	await flushOutbox(s.env, provider);
	assert.equal(count(s, 'outbox_jobs'), 1);
	assert.equal(sends, 1);
});

async function incoming(
	s: ReturnType<typeof testStore>,
	event: CalendarEvent,
	sender: string,
	method: 'REQUEST' | 'REPLY' | 'CANCEL',
	content?: string
) {
	const emailId = await insertEmail(s.db, {
		userId: s.user.id,
		direction: 'inbound',
		from: sender,
		to: s.user.email,
		subject: event.title
	});
	await insertAttachmentBytes(s.db, s.bucket, emailId, {
		filename: 'invite.ics',
		type: 'text/calendar',
		bytes: new TextEncoder().encode(content ?? invitationFile(event, method))
	});
	const attachment = s.sqlite
		.query('SELECT id FROM email_attachments WHERE email_id = ?')
		.get(emailId) as { id: string };
	return { emailId, attachmentId: attachment.id };
}

test('accept, retry, change response, stale updates and cancellation follow event ownership', async () => {
	const s = testStore();
	const template = await saveCalendarEvent(s.db, s.user, { ...input, guests: [] });
	const external = {
		...template,
		uid: 'external-event',
		organizer: { email: 'organizer@example.test', name: 'Organizer' },
		guests: [{ email: s.user.email, name: 'Me', status: 'NEEDS-ACTION' as const }]
	};
	const invite = await incoming(s, external, external.organizer.email, 'REQUEST');
	const body = { attachmentId: invite.attachmentId, response: 'ACCEPTED', version: 0 };
	const accepted = await respondToInvitation(s.env, s.user, invite.emailId, body);
	assert.equal(accepted.owned, false);
	assert.equal(accepted.response, 'ACCEPTED');
	assert.equal(count(s, 'calendar_notices'), 1);
	await respondToInvitation(s.env, s.user, invite.emailId, { ...body, version: 1 });
	assert.equal(count(s, 'calendar_notices'), 1);
	await assert.rejects(
		respondToInvitation(s.env, s.user, invite.emailId, { ...body, response: 'DECLINED' }),
		{ status: 409 }
	);
	const declined = await respondToInvitation(s.env, s.user, invite.emailId, {
		...body,
		response: 'DECLINED',
		version: 1
	});
	assert.equal(declined.response, 'DECLINED');
	assert.equal(
		(
			s.sqlite
				.query('SELECT COUNT(*) AS n FROM calendar_reminders WHERE event_id = ?')
				.get(declined.id) as { n: number }
		).n,
		0
	);
	await assert.rejects(
		saveCalendarEvent(s.db, s.user, { ...input, version: declined.version }, declined.id),
		{ status: 403 }
	);
	const cancel = await incoming(
		s,
		{ ...external, sequence: 1 },
		external.organizer.email,
		'CANCEL'
	);
	const cancelled = await respondToInvitation(s.env, s.user, cancel.emailId, {
		attachmentId: cancel.attachmentId,
		response: 'APPLY',
		version: declined.version
	});
	assert.equal(cancelled.cancelled, true);
	assert.equal(
		(await readCalendarInvitation(s.env, s.user, invite.emailId, invite.attachmentId)).invitation
			.canRespond,
		false
	);
});

test('spoofed organizers, wrong guests, UID collisions and foreign attachments cannot mutate calendar', async () => {
	const s = testStore();
	const own = await saveCalendarEvent(s.db, s.user, input);
	const external = {
		...own,
		uid: 'external',
		organizer: { email: 'host@example.test', name: '' },
		guests: [{ email: s.user.email, name: '', status: 'NEEDS-ACTION' as const }]
	};
	for (const [offered, sender] of [
		[external, 'attacker@example.test'],
		[{ ...external, uid: own.uid }, 'host@example.test'],
		[{ ...external, guests: [] }, 'host@example.test']
	] as [CalendarEvent, string][]) {
		const item = await incoming(s, offered, sender, 'REQUEST');
		assert.equal(
			(await readCalendarInvitation(s.env, s.user, item.emailId, item.attachmentId)).invitation
				.canRespond,
			false
		);
		await assert.rejects(
			respondToInvitation(s.env, s.user, item.emailId, {
				attachmentId: item.attachmentId,
				response: 'ACCEPTED',
				version: 0
			}),
			{ status: 409 }
		);
		await assert.rejects(
			readCalendarInvitation(s.env, { ...s.user, id: 'user-2' }, item.emailId, item.attachmentId),
			{ status: 404 }
		);
	}
	assert.equal(count(s, 'calendar_events'), 1);
});

test('a matching guest reply updates attendance without re-sending invitations or repeating dismissed reminders', async () => {
	const s = testStore();
	const event = await saveCalendarEvent(s.db, s.user, input);
	s.sqlite.exec("UPDATE calendar_reminders SET dismissed_at = '2030-06-20T13:55:00.000Z'");
	const response = { ...event, guests: [{ ...event.guests[0], status: 'ACCEPTED' as const }] };
	const message = await incoming(s, response, response.guests[0].email, 'REPLY');
	const updated = await respondToInvitation(s.env, s.user, message.emailId, {
		attachmentId: message.attachmentId,
		response: 'APPLY',
		version: event.version
	});
	assert.equal(updated.guests[0].status, 'ACCEPTED');
	assert.equal(updated.sequence, event.sequence);
	assert.equal(count(s, 'calendar_notices'), 1);
	assert.ok(
		(
			s.sqlite.query('SELECT dismissed_at FROM calendar_reminders').get() as {
				dismissed_at: string;
			}
		).dismissed_at
	);
});

test('due reminders are claimed once, and editing or cancellation invalidates pending work', async () => {
	const s = testStore();
	const original = await saveCalendarEvent(s.db, s.user, { ...input, guests: [] });
	const now = Date.now();
	const event = {
		...original,
		startsAt: new Date(now + 60_000).toISOString(),
		endsAt: new Date(now + 3600_000).toISOString(),
		version: 2
	};
	await persistCalendarEvent(s.db, s.user.id, event, original);
	await sendCalendarReminders(s.env);
	const row = s.sqlite.query('SELECT notified_at FROM calendar_reminders').get() as {
		notified_at: string;
	};
	assert.ok(row.notified_at);
	await sendCalendarReminders(s.env);
	assert.equal(
		(s.sqlite.query('SELECT notified_at FROM calendar_reminders').get() as { notified_at: string })
			.notified_at,
		row.notified_at
	);
	await cancelCalendarEvent(s.db, s.user, event.id, 2);
	await sendCalendarReminders(s.env);
	assert.equal(count(s, 'calendar_reminders'), 0);
});
