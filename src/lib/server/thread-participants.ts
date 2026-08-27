import type { ThreadParticipant } from '../types';
import {
	formatEmailAddress,
	parseEmailIdentities,
	parseEmailIdentity
} from './email-address';

type ParticipantMessage = {
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
};

export function buildThreadParticipants(messages: ParticipantMessage[]): ThreadParticipant[] {
	// Keep correspondents in first-seen order and enrich address-only entries when
	// a later message supplies a real RFC display name.
	const participants: ThreadParticipant[] = [];
	const addParticipant = (value: string, self: boolean, suppliedName?: string | null) => {
		const identity = parseEmailIdentity(value);
		if (!identity.address) return;
		const name = suppliedName?.trim() || identity.name;

		const existing = self
			? participants.find((entry) => entry.self)
			: participants.find(
					(entry) => !entry.self && entry.address.toLowerCase() === identity.address
				);
		if (existing) {
			if (!existing.self && name && existing.label === existing.address) {
				existing.label = name;
			}
			return;
		}

		participants.push({
			label: self ? 'me' : name || identity.address,
			address: identity.address,
			self
		});
	};

	for (const message of messages) {
		if (message.direction === 'outbound') {
			addParticipant(message.from_addr, true, message.from_name);
			for (const recipient of parseEmailIdentities(message.to_addr)) {
				addParticipant(formatEmailAddress(recipient.name, recipient.address), false);
			}
			continue;
		}

		addParticipant(message.from_addr, false, message.from_name);
	}

	return participants;
}
