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

/** What the sender writes above the forwarded message, in both forms. */
export type ForwardNote = {
	text?: string | null;
	html?: string | null;
};

/** The message as it arrived, ready to sit under whatever the sender adds. */
export function buildForwardedMessage(
	original: ForwardedOriginal,
	options: { note?: ForwardNote } = {}
): { subject: string; text: string; html: string } {
	const headers: Array<[string, string]> = [
		['From', original.from_addr],
		['Date', formatForwardDate(original.created_at)],
		['Subject', original.subject],
		['To', original.to_addr]
	];

	if (original.cc_addr?.trim()) headers.push(['Cc', original.cc_addr.trim()]);

	const noteHtml = options.note?.html?.trim() || null;
	const noteText = options.note?.text?.trim() || (noteHtml ? stripHtml(noteHtml) : '');
	const originalText = original.body_text?.trim() || stripHtml(original.body_html ?? '');
	const originalHtml = original.body_html?.trim() || null;

	const text = [
		noteText ? `${noteText}\n\n` : '',
		'---------- Forwarded message ----------\n',
		headers.map(([label, value]) => `${label}: ${value}`).join('\n'),
		'\n\n',
		originalText
	].join('');

	// `gmail_quote` is what mail clients — this one included — fold a forwarded
	// message behind, so the reader sees the note first rather than the history.
	const html = [
		noteHtml ?? '',
		'<div class="gmail_quote">',
		'<div class="gmail_attr">---------- Forwarded message ----------<br>',
		headers
			.map(([label, value]) => `<b>${label}:</b> ${escapeHtml(value)}`)
			.join('<br>'),
		'</div><br>',
		originalHtml ?? `<p>${escapeHtml(originalText).replaceAll('\n', '<br>\n')}</p>`,
		'</div>'
	].join('');

	return { subject: forwardSubject(original.subject), text, html };
}
