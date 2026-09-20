import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { User, MailAddress } from '$lib/types';
import type { Attendance, CalendarInvitation } from '$lib/organizer/types';
import { getAttachmentForUser, readAttachmentBytes } from './attachments';
import { getEmailForUser } from './mail-store';
import { listAddressesForUser } from './domains';
import { resolveReplyFromAddress } from './outbox';
import { parseEmailAddress } from './email-address';
import { parseInvitation } from './calendar-ical';
import { calendarNotice, eventByUid, persistCalendarEvent } from './calendar';

type Store = { DB: D1Database; ATTACHMENTS: R2Bucket };
export async function readCalendarInvitation(
	env: Store,
	user: User,
	emailId: string,
	attachmentId: string,
	zone = 'UTC'
) {
	const message = await getEmailForUser(env.DB, user.id, emailId);
	if (!message) throw error(404, 'Message not found');
	const attachment = await getAttachmentForUser(env.DB, user.id, emailId, attachmentId);
	if (!attachment) throw error(404, 'Calendar attachment not found');
	if (
		attachment.size_bytes > 256 * 1024 ||
		!(
			attachment.filename.toLowerCase().endsWith('.ics') ||
			attachment.content_type.toLowerCase().startsWith('text/calendar')
		)
	)
		throw error(400, 'Unsupported calendar attachment');
	const bytes = await readAttachmentBytes(env.ATTACHMENTS, attachment);
	if (!bytes || bytes.length > 256 * 1024)
		throw error(400, 'Calendar attachment is unavailable or too large');
	let parsed;
	try {
		parsed = parseInvitation(new TextDecoder().decode(bytes), zone);
	} catch (cause) {
		throw error(400, cause instanceof Error ? cause.message : 'Invalid invitation');
	}
	const { event, method } = parsed;
	event.sourceEmailId = emailId;
	const existing = await eventByUid(env.DB, user.id, event.uid);
	const sender = parseEmailAddress(message.from_addr);
	const addresses = await listAddressesForUser(env.DB, user.id);
	let from: MailAddress | null =
		addresses.find((a) => event.guests.some((g) => g.email === a.address.toLowerCase())) ?? null;
	if (!from && message.direction === 'inbound') {
		const received = await resolveReplyFromAddress(env.DB, user, message);
		if (received && event.guests.some((g) => g.email === received.address.toLowerCase()))
			from = received;
	}
	let warning: string | null = null;
	if (message.direction !== 'inbound') warning = 'This is an outgoing calendar message.';
	else if (method === 'REPLY') {
		if (
			!existing?.owned ||
			event.organizer.email !== existing.organizer.email ||
			event.guests.length !== 1 ||
			event.guests[0].email !== sender ||
			!existing.guests.some((g) => g.email === sender) ||
			event.sequence !== existing.sequence ||
			existing.cancelled
		)
			warning = 'This response does not match an active event and invited guest.';
	} else if (method === 'REQUEST' || method === 'CANCEL') {
		if (!event.organizer.email || event.organizer.email !== sender)
			warning = 'The sender does not match the invitation organizer.';
		else if (!from) warning = 'None of your sending addresses is an invited guest.';
		else if (existing && (existing.owned || existing.organizer.email !== event.organizer.email))
			warning = 'This identifier belongs to a different event.';
		else if (
			existing &&
			(event.sequence < existing.sequence ||
				(existing.cancelled && event.sequence <= existing.sequence))
		)
			warning = 'A newer revision of this invitation is already on your calendar.';
		else if (method === 'REQUEST' && event.cancelled) warning = 'This invitation is cancelled.';
	} else warning = 'This calendar attachment is not a meeting invitation.';
	const invitation: CalendarInvitation = {
		attachmentId,
		event,
		method,
		canRespond: !warning,
		warning,
		existingId: existing?.id ?? null,
		response: existing?.response ?? null,
		existingVersion: existing?.version ?? 0
	};
	return { invitation, existing, from, sender };
}

export async function respondToInvitation(env: Store, user: User, emailId: string, raw: unknown) {
	const parsed = z
		.object({
			attachmentId: z.string().min(1).max(200),
			response: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED', 'APPLY']),
			version: z.number().int().min(0),
			timeZone: z.string().max(100).default('UTC')
		})
		.safeParse(raw);
	if (!parsed.success) throw error(400, 'Choose an invitation response.');
	const input = parsed.data;
	const { invitation, existing, from, sender } = await readCalendarInvitation(
		env,
		user,
		emailId,
		input.attachmentId,
		input.timeZone
	);
	if (!invitation.canRespond)
		throw error(409, invitation.warning || 'Invitation cannot be updated');
	if ((existing?.version ?? 0) !== input.version)
		throw error(409, 'Your calendar changed. Reload this invitation before responding.');
	const { event: offered, method } = invitation;
	if (method === 'REPLY' && existing) {
		if (input.response !== 'APPLY') throw error(400, 'Apply the guest response.');
		const status = offered.guests[0].status;
		if (existing.guests.find((g) => g.email === sender)?.status === status) return existing;
		const event = {
			...existing,
			guests: existing.guests.map((g) => (g.email === sender ? { ...g, status } : g)),
			version: existing.version + 1,
			updatedAt: new Date().toISOString()
		};
		return persistCalendarEvent(env.DB, user.id, event, existing);
	}
	if (!from) throw error(400, 'No invited sending address available');
	if (method === 'CANCEL') {
		if (input.response !== 'APPLY') throw error(400, 'Apply the cancellation.');
		const event = {
			...offered,
			id: existing?.id ?? crypto.randomUUID(),
			cancelled: true,
			version: (existing?.version ?? 0) + 1,
			fromAddressId: from.id,
			updatedAt: new Date().toISOString()
		};
		return persistCalendarEvent(env.DB, user.id, event, existing);
	}
	if (input.response === 'APPLY') throw error(400, 'Choose Accept, Maybe, or Decline.');
	const response: Attendance = input.response;
	if (existing?.response === response && existing.sequence === offered.sequence) return existing;
	const event = {
		...offered,
		id: existing?.id ?? crypto.randomUUID(),
		fromAddressId: from.id,
		response,
		reminderMinutes: existing?.reminderMinutes ?? 10,
		version: (existing?.version ?? 0) + 1,
		updatedAt: new Date().toISOString(),
		guests: offered.guests.map((g) =>
			g.email === from.address.toLowerCase() ? { ...g, status: response } : g
		)
	};
	const reply = event.guests.find((g) => g.email === from.address.toLowerCase())!;
	return persistCalendarEvent(env.DB, user.id, event, existing, [
		calendarNotice(user, from, event, event.organizer.email, 'REPLY', reply)
	]);
}
