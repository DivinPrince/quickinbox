import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { organizerSession } from '$lib/server/organizer-http';
import { getCalendarEvent } from '$lib/server/calendar';
import { getEmailForUser } from '$lib/server/mail-store';
import { parseEmailIdentities } from '$lib/server/email-address';
export const load: PageServerLoad = async (event) => {
	const { env, user } = organizerSession(event);
	const emailId = event.url.searchParams.get('email');
	const message = emailId ? await getEmailForUser(env.DB, user.id, emailId) : null;
	if (emailId && !message) throw error(404, 'Message not found');
	const eventId = event.url.searchParams.get('event');
	const selected = eventId ? await getCalendarEvent(env.DB, user.id, eventId) : null;
	if (eventId && !selected) throw error(404, 'Event not found');
	const own = new Set(event.locals.addresses.map((a) => a.address.toLowerCase()));
	const people = message
		? parseEmailIdentities(
				[message.from_addr, message.to_addr, message.cc_addr].filter(Boolean).join(', ')
			).filter((p) => !own.has(p.address))
		: [];
	return {
		selected,
		addresses: event.locals.addresses,
		seed: {
			title: message?.subject.slice(0, 180) ?? '',
			description: message?.body_text?.slice(0, 8000) ?? '',
			sourceEmailId: emailId,
			guests: message
				? [...new Set(people.map((p) => p.address))].slice(0, 30).join(', ')
				: (event.url.searchParams.get('guest') || '').slice(0, 254)
		}
	};
};
