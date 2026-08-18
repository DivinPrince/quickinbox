import type { MailAddress, OutboundAttachmentInput } from '$lib/types';
import type { EmailProvider } from './email-provider';

export type OutboundMailInput = {
	from: MailAddress;
	senderName: string;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	subject: string;
	text: string;
	html?: string;
	inReplyTo?: string | null;
	references?: string | null;
	headers?: Record<string, string>;
	attachments?: OutboundAttachmentInput[];
	idempotencyKey?: string;
};

export type OutboundMailResult = {
	providerId: string;
};

export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export function formatMessageId(value: string | null | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	const trimmed = value.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
	return `<${trimmed.replace(/^<|>$/g, '')}>`;
}

export function normalizeMessageId(value: string | null | undefined): string | null {
	if (!value?.trim()) return null;
	return value.trim().replace(/^<|>$/g, '');
}

/** Every id in a References chain, each wrapped in angle brackets. */
export function formatReferences(value: string | null | undefined): string | undefined {
	if (!value?.trim()) return undefined;

	const ids = value
		.split(/[\s,]+/)
		.map((part) => part.trim().replace(/^<|>$/g, ''))
		.filter(Boolean);

	return ids.length ? ids.map((id) => `<${id}>`).join(' ') : undefined;
}

export function validateSubject(subject: string): string | null {
	const trimmed = subject.trim();
	if (!trimmed) return 'Subject is required';
	if (trimmed.length > 200) return 'Subject must be 200 characters or fewer';
	return null;
}

/** Split a comma-separated recipient field into addresses the provider will accept. */
export function parseRecipients(value: string | string[] | undefined | null): string[] {
	if (!value) return [];
	const parts = Array.isArray(value) ? value : value.split(',');
	return parts.map((part) => part.trim()).filter((part) => part.includes('@'));
}

/**
 * Wrap composed HTML in a minimal document so mail clients get sane defaults.
 * Deliberately unbranded — this is a mail client, not a marketing tool, so the
 * recipient sees exactly what was written.
 */
export function buildHtmlEmail(bodyHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111111;">
${bodyHtml}
</body>
</html>`;
}

export async function sendOutboundEmail(
	provider: EmailProvider,
	input: OutboundMailInput
): Promise<OutboundMailResult> {
	const subjectError = validateSubject(input.subject);
	if (subjectError) {
		throw new Error(subjectError);
	}

	const to = parseRecipients(input.to);
	if (to.length === 0) {
		throw new Error('At least one valid recipient is required');
	}

	const cc = parseRecipients(input.cc);
	const bcc = parseRecipients(input.bcc);
	const safeText = input.text.trim();
	const bodyHtml = input.html?.trim() || escapeHtml(safeText).replaceAll('\n', '<br>\n');

	const headers: Record<string, string> = { ...input.headers };
	const inReplyTo = formatMessageId(input.inReplyTo);
	// References is a chain, In-Reply-To a single id. Both matter: mail clients
	// on the other side thread on them, and so do we when the reply comes back.
	const references = formatReferences(input.references) ?? inReplyTo;
	if (inReplyTo || references) {
		if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
		if (references) headers['References'] = references;
	}

	return provider.send({
		from: input.from,
		senderName: input.senderName,
		to,
		...(cc.length ? { cc } : {}),
		...(bcc.length ? { bcc } : {}),
		subject: input.subject.trim(),
		text: safeText,
		html: buildHtmlEmail(bodyHtml),
		inReplyTo,
		references,
		...(Object.keys(headers).length ? { headers } : {}),
		attachments: input.attachments,
		idempotencyKey: input.idempotencyKey ?? crypto.randomUUID()
	});
}
