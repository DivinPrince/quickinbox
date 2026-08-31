import type { D1Database } from '@cloudflare/workers-types';

/**
 * Conversation grouping.
 *
 * Mail threading is normally a pure header problem: a reply carries
 * `In-Reply-To` and `References` pointing at the Message-IDs it answers. That
 * works for inbound mail, because we store the Message-ID Resend reports on
 * every received message.
 *
 * It does *not* work for mail we send. Resend's send API returns its own email
 * id, never the Message-ID it stamped on the wire, so when the recipient
 * answers something we started, their reply references an id we have no record
 * of. Hence the third rule below: same normalized subject, shared participant,
 * recent.
 */

/** "Re:", "Fwd:", "FW:", "Re[2]:" … stripped one layer at a time. */
const SUBJECT_PREFIX = /^\s*(re|fw|fwd)\s*(\[\d+\])?\s*:\s*/i;

/** Conversations stop absorbing new mail after this long without activity. */
const SUBJECT_MATCH_DAYS = 180;

/** Keeps the SQL `IN (...)` list and the participant scan bounded. */
const MAX_REFERENCE_IDS = 20;
const MAX_PARTICIPANTS = 8;

/**
 * The subject with every reply/forward prefix removed, lowercased. Mirrored by
 * the backfill in migrations/0007_threads.sql.
 */
export function normalizeSubject(subject: string): string {
	return stripSubjectPrefixes(subject).toLowerCase();
}

function stripSubjectPrefixes(subject: string): string {
	let value = subject.trim();

	for (;;) {
		const stripped = value.replace(SUBJECT_PREFIX, '').trim();
		if (stripped === value) return value;
		value = stripped;
	}
}

/**
 * What a conversation is called. The oldest message we hold may itself be a
 * reply — the thread that started elsewhere still reads as one subject, not as
 * "Re: Re: …".
 */
export function displaySubject(subject: string): string {
	return stripSubjectPrefixes(subject) || subject.trim();
}

/** `<a@x> <b@y>` → `['a@x', 'b@y']`, newest reference last as senders write them. */
export function parseMessageIds(...headers: Array<string | null | undefined>): string[] {
	const ids: string[] = [];

	for (const header of headers) {
		if (!header) continue;
		for (const part of header.split(/[\s,]+/)) {
			const id = part.trim().replace(/^<|>$/g, '');
			if (id && !ids.includes(id)) ids.push(id);
		}
	}

	return ids;
}

/** Build the References header for a reply: the parent's chain plus the parent. */
export function buildReferences(
	parentReferences: string | null | undefined,
	parentMessageId: string | null | undefined
): string | null {
	const ids = parseMessageIds(parentReferences, parentMessageId);
	if (ids.length === 0) return null;
	return ids.slice(-MAX_REFERENCE_IDS).map((id) => `<${id}>`).join(' ');
}

function addressesIn(value: string | null | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map((part) => {
			const match = part.match(/<([^>]+)>/);
			return (match ? match[1] : part).trim().toLowerCase();
		})
		.filter((address) => address.includes('@'));
}

export type ThreadLookup = {
	/** Id already minted for the message being inserted; used as a new thread id. */
	emailId: string;
	direction: 'inbound' | 'outbound';
	subject: string;
	from: string;
	to: string;
	cc?: string | null;
	inReplyTo?: string | null;
	references?: string | null;
	replyToEmailId?: string | null;
	/** Mailbox domain boundary; conversations never cross it when present. */
	domainId?: string | null;
	/** Drafts start their own conversation instead of joining one by subject. */
	subjectMatch?: boolean;
};

/**
 * Finds the conversation this message belongs to, in order of confidence:
 * an explicit parent we recorded, a referenced Message-ID we stored, then the
 * subject/participant fallback. Falls back to starting a new conversation.
 */
export async function resolveThreadId(
	db: D1Database,
	userId: string,
	input: ThreadLookup
): Promise<string> {
	const domainClause = input.domainId ? ' AND domain_id = ?' : '';
	const domainBindings = input.domainId ? [input.domainId] : [];

	if (input.replyToEmailId) {
		const parent = await db
			.prepare(`SELECT thread_id, id FROM emails WHERE id = ? AND user_id = ?${domainClause}`)
			.bind(input.replyToEmailId, userId, ...domainBindings)
			.first<{ thread_id: string | null; id: string }>();

		if (parent) return parent.thread_id ?? parent.id;
	}

	// In-Reply-To first: it is the direct parent. References covers the rest of
	// the chain, which matters when the only message we stored is further back.
	const referenced = parseMessageIds(input.inReplyTo, input.references).slice(0, MAX_REFERENCE_IDS);
	if (referenced.length > 0) {
		const placeholders = referenced.map(() => '?').join(', ');
		const match = await db
			.prepare(
				`SELECT thread_id, id FROM emails
				 WHERE user_id = ?
				 ${domainClause}
				 AND message_id IS NOT NULL
				 AND replace(replace(message_id, '<', ''), '>', '') IN (${placeholders})
				 ORDER BY datetime(created_at) DESC LIMIT 1`
			)
			.bind(userId, ...domainBindings, ...referenced)
			.first<{ thread_id: string | null; id: string }>();

		if (match) return match.thread_id ?? match.id;
	}

	if (input.subjectMatch !== false) {
		const threadKey = normalizeSubject(input.subject);
		// Only the correspondent side identifies a conversation. Including both
		// sides lets every message overlap through the user's own mailbox.
		const correspondentAddresses =
			input.direction === 'inbound'
				? addressesIn(input.from)
				: [...addressesIn(input.to), ...addressesIn(input.cc)];
		const participants = [
			...new Set(correspondentAddresses)
		].slice(0, MAX_PARTICIPANTS);

		if (threadKey && threadKey !== '(no subject)' && participants.length > 0) {
			const overlap = participants
				.map(
					() =>
						`instr(lower(from_addr || ' ' || to_addr || ' ' || COALESCE(cc_addr, '')), ?) > 0`
				)
				.join(' OR ');

			const match = await db
				.prepare(
					`SELECT thread_id, id FROM emails
					 WHERE user_id = ?
					 AND thread_key = ?
					 ${domainClause}
					 AND (status IS NULL OR status <> 'draft')
					 AND datetime(created_at) > datetime('now', ?)
					 AND (${overlap})
					 ORDER BY datetime(created_at) DESC LIMIT 1`
				)
				.bind(userId, threadKey, ...domainBindings, `-${SUBJECT_MATCH_DAYS} day`, ...participants)
				.first<{ thread_id: string | null; id: string }>();

			if (match) return match.thread_id ?? match.id;
		}
	}

	return input.emailId;
}

