import { Temporal } from '@js-temporal/polyfill';

export function validTimeZone(value: string): boolean {
	try {
		Temporal.Now.instant().toZonedDateTimeISO(value);
		return !/^[+-]/.test(value);
	} catch {
		return false;
	}
}

export function eventTimes(start: string, end: string, timeZone: string, allDay: boolean) {
	if (!validTimeZone(timeZone))
		throw new Error('Choose a valid time zone, such as America/Chicago.');
	const pattern = allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
	if (!pattern.test(start) || !pattern.test(end))
		throw new Error('Enter valid start and end dates.');
	try {
		const a = Temporal.PlainDateTime.from(allDay ? `${start}T00:00` : start);
		const b = Temporal.PlainDateTime.from(allDay ? `${end}T00:00` : end);
		if (a.year < 1970 || b.year > 2100) throw new Error('range');
		const opts = { disambiguation: allDay ? ('compatible' as const) : ('reject' as const) };
		const first = a.toZonedDateTime(timeZone, opts).epochMilliseconds;
		const last = b.toZonedDateTime(timeZone, opts).epochMilliseconds;
		if (last <= first || last - first > 366 * 86_400_000) throw new Error('range');
		return { startsAt: new Date(first).toISOString(), endsAt: new Date(last).toISOString() };
	} catch {
		throw new Error(
			'End must follow start (maximum one year). Times skipped or repeated by daylight saving require a different time or UTC.'
		);
	}
}

export function localTime(iso: string, zone: string, allDay = false): string {
	const date = Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
	return allDay
		? date.toPlainDate().toString()
		: date.toPlainDateTime().toString({ smallestUnit: 'minute' });
}

export function shiftDate(date: string, days: number): string {
	return Temporal.PlainDate.from(date).add({ days }).toString();
}
