import { stripHtml } from './html';
import { escapeHtml } from './send-mail';

/**
 * Forwarding a message.
 *
 * A forward is not a reply: it carries the original to someone who has not seen
 * it, so the message itself becomes the content. What the sender adds is a note
 * on top, and everything below the divider is the message as it arrived —
 * headers included, because without them a forward loses who sent it and when.
 */

/** Already a forward? Senders write "Fwd:", "FW:" and "Fwd[2]:" for the same thing. */
const FORWARD_PREFIX = /^\s*(fw|fwd)\s*(\[\d+\])?\s*:/i;

export type ForwardedOriginal = {
	from_addr: string;
	to_addr: string;
	cc_addr?: string | null;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	created_at: string;
};

function forwardTimestamp(value: string): number {
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())
		? `${value.trim().replace(' ', 'T')}Z`
		: value;
	const timestamp = new Date(normalized).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function orderForwardedMessages<T extends ForwardedOriginal>(messages: T[]): T[] {
	return [...messages].sort(
		(left, right) => forwardTimestamp(left.created_at) - forwardTimestamp(right.created_at)
	);
}

export function forwardSubject(subject: string): string {
	const trimmed = subject.trim();
	if (!trimmed) return 'Fwd:';
	return FORWARD_PREFIX.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

/**
 * D1 stores `datetime('now')` as `YYYY-MM-DD HH:MM:SS` in UTC. Parsed as-is
 * that reads as local time in some runtimes, so the zone is made explicit
 * before it is turned into the RFC 2822 form mail headers use.
 */
export function formatForwardDate(createdAt: string): string {
	const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt.trim())
		? `${createdAt.trim().replace(' ', 'T')}Z`
		: createdAt;

	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? createdAt : date.toUTCString();
}

/** Plain text as a paragraph, for the HTML part of a message that lacks one. */
function asHtmlParagraph(text: string): string {
	return `<p>${escapeHtml(text).replaceAll('\n', '<br>\n')}</p>`;
}

/** What the sender writes above the forwarded message, in both forms. */
export type ForwardNote = {
	text?: string | null;
	html?: string | null;
};

function forwardedHeaders(original: ForwardedOriginal): Array<[string, string]> {
	const headers: Array<[string, string]> = [
		['From', original.from_addr],
		['Date', formatForwardDate(original.created_at)],
		['To', original.to_addr]
	];

	if (original.cc_addr?.trim()) headers.push(['Cc', original.cc_addr.trim()]);
	headers.push(['Subject', original.subject]);
	return headers;
}

/**
 * One or more messages as they arrived, oldest first, ready to sit under the
 * sender's note. Bcc is intentionally absent from ForwardedOriginal so it can
 * never leak into either rendered form.
 */
export function buildForwardedMessages(
	originals: ForwardedOriginal[],
	options: { note?: ForwardNote } = {}
): { subject: string; text: string; html: string } {
	if (originals.length === 0) throw new Error('At least one message is required to forward');
	const ordered = orderForwardedMessages(originals);

	// The two forms fill in for each other: a note written in one still reaches a
	// recipient whose client shows the other.
	const writtenHtml = options.note?.html?.trim() || null;
	const noteText = options.note?.text?.trim() || (writtenHtml ? stripHtml(writtenHtml) : '');
	const noteHtml = writtenHtml ?? (noteText ? asHtmlParagraph(noteText) : '');
	const textMessages = ordered.map((original) => {
		const headers = forwardedHeaders(original);
		const originalText = original.body_text?.trim() || stripHtml(original.body_html ?? '');
		return [
			'---------- Forwarded message ----------\n',
			headers.map(([label, value]) => `${label}: ${value}`).join('\n'),
			'\n\n',
			originalText
		].join('');
	});

	const text = `${noteText ? `${noteText}\n\n` : ''}${textMessages.join('\n\n')}`;

	// `gmail_quote` is what mail clients — this one included — fold a forwarded
	// message behind, so the reader sees the note first rather than the history.
	const htmlMessages = ordered.map((original) => {
		const headers = forwardedHeaders(original);
		const originalText = original.body_text?.trim() || stripHtml(original.body_html ?? '');
		const originalHtml = original.body_html?.trim() || null;
		return [
			'<div class="gmail_quote">',
			'<div class="gmail_attr">---------- Forwarded message ----------<br>',
			headers
				.map(([label, value]) => `<b>${label}:</b> ${escapeHtml(value)}`)
				.join('<br>'),
			'</div><br>',
			originalHtml ?? asHtmlParagraph(originalText),
			'</div>'
		].join('');
	});

	return {
		subject: forwardSubject(ordered[0].subject),
		text,
		html: `${noteHtml}${htmlMessages.join('<br>')}`
	};
}

/** Backwards-compatible single-message builder used by the existing endpoint. */
export function buildForwardedMessage(
	original: ForwardedOriginal,
	options: { note?: ForwardNote } = {}
): { subject: string; text: string; html: string } {
	return buildForwardedMessages([original], options);
}
