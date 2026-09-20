import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import type { CalendarEvent, CalendarGuest } from '$lib/organizer/types';
import { eventTimes, localTime, validTimeZone } from '$lib/organizer/dates';
import { z } from 'zod';

const address = z.string().email().max(254);
const attendance = new Set(['NEEDS-ACTION', 'ACCEPTED', 'TENTATIVE', 'DECLINED']);
function email(value: unknown): string {
	const parsed = address.safeParse(
		String(value ?? '')
			.replace(/^mailto:/i, '')
			.toLowerCase()
	);
	if (!parsed.success) throw new Error('The invitation contains an invalid email address.');
	return parsed.data;
}
function string(component: ICAL.Component, name: string, max: number, fallback = '') {
	const value = String(component.getFirstPropertyValue(name) ?? fallback);
	if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
		throw new Error('Invitation fields exceed supported limits.');
	return value;
}

/** Parse only a bounded, single occurrence. Never fetch URLs or execute alarms. */
export function parseInvitation(
	source: string,
	fallbackZone = 'UTC'
): { event: CalendarEvent; method: string } {
	if (new TextEncoder().encode(source).length > 256 * 1024)
		throw new Error('Calendar file is too large (maximum 256 KB).');
	// Bound nesting before entering the library parser.
	let depth = 0;
	for (const line of source.split(/\r?\n/)) {
		if (/^BEGIN:/i.test(line) && ++depth > 8)
			throw new Error('Calendar file is nested too deeply.');
		if (/^END:/i.test(line)) depth--;
		if (depth < 0) throw new Error('Invalid calendar file.');
	}
	if (depth !== 0) throw new Error('Invalid calendar file.');
	const root = new ICAL.Component(ICAL.parse(source));
	if (root.name !== 'vcalendar') throw new Error('Expected an iCalendar file.');
	const parts = root.getAllSubcomponents('vevent');
	if (parts.length !== 1) throw new Error('Open a calendar file containing one event.');
	const item = parts[0];
	if (['rrule', 'rdate', 'exdate', 'recurrence-id'].some((key) => item.hasProperty(key))) {
		throw new Error(
			'Recurring invitations are not supported yet. Download the file to open the complete series in another calendar.'
		);
	}
	const method = string(root, 'method', 30, 'PUBLISH').toUpperCase();
	if (!['REQUEST', 'REPLY', 'CANCEL', 'PUBLISH'].includes(method))
		throw new Error('This calendar message type is not supported.');
	const uid = string(item, 'uid', 512);
	if (!uid || /[\r\n]/.test(uid)) throw new Error('Invitation has no valid event identifier.');
	const start = item.getFirstPropertyValue('dtstart') as ICAL.Time | null;
	let end = item.getFirstPropertyValue('dtend') as ICAL.Time | null;
	if (!start) throw new Error('Invitation has no start time.');
	if (!end && item.hasProperty('duration')) {
		end = start.clone();
		end.addDuration(item.getFirstPropertyValue('duration') as ICAL.Duration);
	}
	if (!end && start.isDate) {
		end = start.clone();
		end.adjust(1, 0, 0, 0);
	}
	if (!end || start.isDate !== end.isDate) throw new Error('Invitation has no valid end time.');
	const zoneParam = String(item.getFirstProperty('dtstart')?.getParameter('tzid') ?? '');
	const zone = validTimeZone(zoneParam)
		? zoneParam
		: validTimeZone(fallbackZone)
			? fallbackZone
			: 'UTC';
	function instant(time: ICAL.Time, property: string): string {
		const tzid = String(item.getFirstProperty(property)?.getParameter('tzid') ?? zoneParam);
		const local = time.toString().replace(/Z$/, '');
		if (time.isDate)
			return eventTimes(
				local,
				Temporal.PlainDate.from(local).add({ days: 1 }).toString(),
				zone,
				true
			).startsAt;
		if (time.zone === ICAL.Timezone.utcTimezone || /Z$/.test(time.toString()))
			return new Date(time.toJSDate()).toISOString();
		const embedded = tzid ? root.getTimeZoneByID(tzid) : null;
		if (embedded) {
			const zoned = ICAL.Time.fromString(local, item.getFirstProperty(property)!);
			zoned.zone = embedded;
			return zoned.toJSDate().toISOString();
		}
		if (tzid && !validTimeZone(tzid))
			throw new Error(`Unsupported invitation time zone: ${tzid.slice(0, 80)}`);
		return new Date(
			Temporal.PlainDateTime.from(local).toZonedDateTime(tzid || zone, { disambiguation: 'reject' })
				.epochMilliseconds
		).toISOString();
	}
	const startsAt = instant(start, 'dtstart');
	const endsAt = instant(end, 'dtend');
	if (
		endsAt <= startsAt ||
		Date.parse(endsAt) - Date.parse(startsAt) > 366 * 86_400_000 ||
		Number(startsAt.slice(0, 4)) < 1970 ||
		Number(endsAt.slice(0, 4)) > 2100
	)
		throw new Error('Invitation dates are outside supported limits.');
	const organizer = item.getFirstProperty('organizer');
	const guests: CalendarGuest[] = item.getAllProperties('attendee').map((prop) => {
		const status = String(prop.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase();
		return {
			email: email(prop.getFirstValue()),
			name: String(prop.getParameter('cn') ?? '').slice(0, 200),
			status: attendance.has(status) ? (status as CalendarGuest['status']) : 'NEEDS-ACTION'
		};
	});
	if (guests.length > 50 || new Set(guests.map((g) => g.email)).size !== guests.length)
		throw new Error('Invitation has too many or duplicate guests.');
	const sequence = Number(item.getFirstPropertyValue('sequence') ?? 0);
	if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 1_000_000)
		throw new Error('Invalid invitation revision.');
	return {
		method,
		event: {
			id: '',
			uid,
			title: string(item, 'summary', 180, 'Untitled event'),
			description: string(item, 'description', 8000),
			location: string(item, 'location', 500),
			startsAt,
			endsAt,
			startLocal: start.isDate ? start.toString() : localTime(startsAt, zone),
			endLocal: end.isDate ? end.toString() : localTime(endsAt, zone),
			timeZone: zone,
			allDay: start.isDate,
			color: '#729681',
			organizer: {
				email: organizer ? email(organizer.getFirstValue()) : '',
				name: String(organizer?.getParameter('cn') ?? '').slice(0, 200)
			},
			guests,
			owned: false,
			fromAddressId: null,
			sourceEmailId: null,
			response: 'NEEDS-ACTION',
			reminderMinutes: 10,
			version: 0,
			sequence,
			cancelled: method === 'CANCEL' || item.getFirstPropertyValue('status') === 'CANCELLED',
			updatedAt: new Date().toISOString()
		}
	};
}

export function invitationFile(
	event: CalendarEvent,
	method: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH',
	reply?: CalendarGuest
): string {
	const root = new ICAL.Component('vcalendar');
	root.addPropertyWithValue('version', '2.0');
	root.addPropertyWithValue('prodid', '-//Quickinbox//Calendar//EN');
	root.addPropertyWithValue('method', method);
	const item = new ICAL.Component('vevent');
	root.addSubcomponent(item);
	for (const [key, value] of Object.entries({
		uid: event.uid,
		summary: event.title,
		description: event.description,
		location: event.location,
		sequence: event.sequence,
		status: method === 'CANCEL' || event.cancelled ? 'CANCELLED' : 'CONFIRMED'
	}))
		item.addPropertyWithValue(key, value);
	item.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(event.updatedAt), true));
	item.addPropertyWithValue(
		'dtstart',
		event.allDay
			? ICAL.Time.fromDateString(event.startLocal)
			: ICAL.Time.fromJSDate(new Date(event.startsAt), true)
	);
	item.addPropertyWithValue(
		'dtend',
		event.allDay
			? ICAL.Time.fromDateString(event.endLocal)
			: ICAL.Time.fromJSDate(new Date(event.endsAt), true)
	);
	if (event.organizer.email) {
		const organizer = new ICAL.Property('organizer');
		organizer.setValue(`mailto:${event.organizer.email}`);
		if (event.organizer.name) organizer.setParameter('cn', event.organizer.name);
		item.addProperty(organizer);
	}
	for (const guest of reply ? [reply] : event.guests) {
		const attendee = new ICAL.Property('attendee');
		attendee.setValue(`mailto:${guest.email}`);
		if (guest.name) attendee.setParameter('cn', guest.name);
		attendee.setParameter('partstat', guest.status);
		if (method === 'REQUEST') attendee.setParameter('rsvp', 'TRUE');
		item.addProperty(attendee);
	}
	return root.toString() + '\r\n';
}
