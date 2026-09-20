import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import PostalMime, { type Address } from 'postal-mime';
import { archivePath, IMPORT_FOLDERS, MAX_EML_BYTES, MailTransferError, type ImportFolder, type ImportResult } from '$lib/mail/transfer';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL, MAX_BODY_BYTES } from './constants';
import { normalizeContentId } from './attachments';
import { createLabel, getLabel, listLabels, MAX_LABEL_NAME } from './labels';
import { normalizeSubject, resolveThreadId } from './threads';
import { normalizeMessageId } from './send-mail';
import { inboundAttachmentMetadata } from './inbound';

export type ImportOptions = {
	addressId: string;
	folder: ImportFolder;
	labelId: string | null;
	path: string;
	preserveFolders: boolean;
};

export function parseImportOptions(params: URLSearchParams): ImportOptions {
	const folder = params.get('folder') ?? 'inbox';
	if (!IMPORT_FOLDERS.includes(folder as ImportFolder)) throw new MailTransferError('Choose a valid destination folder.');
	const path = archivePath(params.get('path') ?? 'message.eml');
	if (!/\.eml$/i.test(path)) throw new MailTransferError('Only EML messages can be imported.');
	const addressId = params.get('address') ?? '';
	if (!addressId) throw new MailTransferError('Choose a destination address.');
	return { addressId, folder: folder as ImportFolder, path, labelId: params.get('label') || null, preserveFolders: params.get('preserveFolders') === 'true' };
}

export async function readImportBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
	if (Number(request.headers.get('content-length')) > MAX_EML_BYTES) throw new MailTransferError('Each EML must be 20 MB or smaller.', 413);
	if (!request.body) throw new MailTransferError('The message is empty.');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > MAX_EML_BYTES) { await reader.cancel(); throw new MailTransferError('Each EML must be 20 MB or smaller.', 413); }
			chunks.push(next.value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return bytes;
}

function addresses(value: Address[] | undefined): string[] {
	return (value ?? []).flatMap((item) => item.group ? addresses(item.group) : item.address ? [item.address] : []);
}

/** Archive ingestion has no delivery, notification, classification, or unarchive side effects. */
export async function importMessage(db: D1Database, bucket: R2Bucket, userId: string,
	raw: Uint8Array<ArrayBuffer>, options: ImportOptions): Promise<ImportResult> {
	if (!raw.length || raw.length > MAX_EML_BYTES) throw new MailTransferError('Each EML must be between 1 byte and 20 MB.');
	const address = await db.prepare('SELECT id, address, domain_id FROM addresses WHERE id = ? AND user_id = ?')
		.bind(options.addressId, userId).first<{ id: string; address: string; domain_id: string }>();
	if (!address) throw new MailTransferError('Destination address not found.', 404);
	const label = options.labelId ? await getLabel(db, userId, options.labelId) : null;
	if (options.labelId && !label) throw new MailTransferError('Destination label not found.', 404);
	const folderPath = options.preserveFolders ? archivePath(options.path).split('/').slice(0, -1).join('/') : '';
	const labelName = folderPath ? [label?.name, folderPath].filter(Boolean).join('/') : '';
	if (labelName.length > MAX_LABEL_NAME) throw new MailTransferError(`Folder label “${labelName}” exceeds ${MAX_LABEL_NAME} characters. Import without preserving folders or shorten the folder names.`);
	const digest = await crypto.subtle.digest('SHA-256', raw);
	const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	let parsed;
	try { parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 30 }); }
	catch { throw new MailTransferError('This file could not be parsed as an EML message.'); }
	if (!parsed.from?.address || !parsed.from.address.includes('@')) throw new MailTransferError('This EML is missing a valid From header.');
	const messageId = normalizeMessageId(parsed.messageId);
	const duplicate = () => db.prepare(`SELECT id FROM emails WHERE user_id = ? AND
		(import_hash = ? OR (? IS NOT NULL AND replace(replace(message_id, '<', ''), '>', '') = ?)) LIMIT 1`)
		.bind(userId, hash, messageId, messageId).first<{ id: string }>();
	const existing = await duplicate();
	if (existing) return { status: 'skipped', id: existing.id };
	if (parsed.attachments.length > MAX_ATTACHMENTS_PER_EMAIL) throw new MailTransferError(`This message has more than ${MAX_ATTACHMENTS_PER_EMAIL} attachments.`);
	const attachments = parsed.attachments.map((attachment) => {
		if (!(attachment.content instanceof ArrayBuffer)) throw new MailTransferError('An attachment could not be decoded.');
		const bytes = new Uint8Array(attachment.content);
		if (bytes.length > MAX_ATTACHMENT_BYTES) throw new MailTransferError(`Attachment “${attachment.filename || 'attachment'}” exceeds 5 MB.`);
		return { attachment, bytes };
	});
	const id = crypto.randomUUID();
	const rawKey = `${id}/original.eml`;
	const direction = options.folder === 'sent' ? 'outbound' : 'inbound';
	const subject = parsed.subject?.trim() || '(no subject)';
	const to = addresses(parsed.to).join(', ') || address.address;
	const cc = addresses(parsed.cc).join(', ') || null;
	const inReplyTo = normalizeMessageId(parsed.inReplyTo);
	const threadId = await resolveThreadId(db, userId, { emailId: id, direction, subject, from: parsed.from.address,
		to, cc, inReplyTo, references: parsed.references, domainId: address.domain_id, subjectMatch: false });
	const parsedDate = parsed.date ? new Date(parsed.date) : null;
	const date = (parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : new Date()).toISOString().replace('T', ' ').slice(0, 19);
	let truncated = false;
	function displayBody(value: string | undefined): string | null {
		if (!value) return null;
		const bytes = new TextEncoder().encode(value);
		if (bytes.length <= MAX_BODY_BYTES) return value;
		truncated = true;
		return new TextDecoder().decode(bytes.subarray(0, MAX_BODY_BYTES));
	}
	const statements = [db.prepare(`INSERT INTO emails (id, user_id, direction, from_addr, from_name, to_addr, cc_addr, bcc_addr,
		subject, body_text, body_html, message_id, in_reply_to, references_header, thread_id, thread_key, domain_id, address_id,
		status, is_read, created_at, updated_at, archived_at, spam_at, deleted_at, category_source, raw_message_key, raw_message_bytes, import_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), ?, ?, ?, 'user', ?, ?, ?)`)
		.bind(id, userId, direction, parsed.from.address, parsed.from.name || null, to, cc, addresses(parsed.bcc).join(', ') || null,
			subject, displayBody(parsed.text), displayBody(parsed.html), messageId, inReplyTo, parsed.references ?? null, threadId,
			normalizeSubject(subject), address.domain_id, address.id, direction === 'outbound' ? 'sent' : null, date,
			options.folder === 'archive' ? date : null, options.folder === 'spam' ? date : null, options.folder === 'trash' ? date : null,
			rawKey, raw.length, hash)];
	const keys: string[] = [];
	try {
		keys.push(rawKey);
		await bucket.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } });
		for (const { attachment, bytes } of attachments) {
			const attachmentId = crypto.randomUUID();
			const key = `${id}/${attachmentId}`;
			keys.push(key);
			await bucket.put(key, bytes, { httpMetadata: { contentType: attachment.mimeType || 'application/octet-stream' } });
			const metadata = inboundAttachmentMetadata(attachment);
			statements.push(db.prepare(`INSERT INTO email_attachments (id, email_id, filename, content_type, size_bytes,
				content_base64, storage_key, content_disposition, content_id) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`)
				.bind(attachmentId, id, attachment.filename || 'attachment', attachment.mimeType || 'application/octet-stream', bytes.length,
					key, metadata.disposition ?? null, normalizeContentId(metadata.contentId)));
		}
		let labelId = label?.id;
		if (labelName) {
			const matching = (await listLabels(db, userId)).find((item) => item.name === labelName);
			labelId = (matching ?? await createLabel(db, userId, { name: labelName })).id;
		}
		if (labelId) statements.push(db.prepare("INSERT INTO email_labels (email_id, label_id, source) VALUES (?, ?, 'user')").bind(id, labelId));
		statements.push(db.prepare('UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = ?').bind(userId));
		await db.batch(statements);
		return { status: 'imported', id, ...(truncated ? { warning: 'The displayed body was shortened; the complete original is preserved for export.' } : {}) };
	} catch (error) {
		// D1 batches are atomic. Check for an ambiguous successful commit before removing its files.
		const committed = await db.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?').bind(id, userId).first<{ id: string }>();
		if (committed) return { status: 'imported', id };
		await bucket.delete(keys);
		const raced = await duplicate();
		if (raced) return { status: 'skipped', id: raced.id };
		throw error;
	}
}
