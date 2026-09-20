import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Zip, ZipPassThrough } from 'fflate';
import type { EmailRow } from '$lib/types';
import { EXPORT_FOLDERS, MailTransferError, type ExportFolder } from '$lib/mail/transfer';
import { bytesToBase64, normalizeContentId, readAttachmentBytes } from './attachments';
import { getLabel } from './labels';

const PART_SIZE = 1000;
const PART_BYTES = 400 * 1024 * 1024;
// Conservative MIME/base64 estimate; the original size is exact for imports.
const SIZE_SQL = `COALESCE(e.raw_message_bytes, 16384 + 2 * (
	COALESCE(length(CAST(e.body_text AS BLOB)), 0) + COALESCE(length(CAST(e.body_html AS BLOB)), 0)
	+ COALESCE((SELECT SUM(a.size_bytes + 4096) FROM email_attachments a WHERE a.email_id = e.id), 0)))`;
type Scope = { where: string; bindings: (string | number)[]; folder: ExportFolder; labelName?: string };
type ExportEmail = EmailRow & { export_cursor: number; raw_message_key: string | null };
type Attachment = { email_id: string; filename: string; content_type: string; content_disposition: string | null;
	content_id: string | null; storage_key: string | null; content_base64: string | null };
export type ExportPart = { after: number; through: number; count: number };

export async function exportScope(db: D1Database, userId: string, params: URLSearchParams): Promise<Scope> {
	const folder = params.get('folder') ?? 'all';
	if (!EXPORT_FOLDERS.includes(folder as ExportFolder)) throw new MailTransferError('Choose a valid export folder.');
	const filters = ['e.user_id = ?', "(e.status IS NULL OR e.status NOT IN ('draft', 'pending', 'sending', 'uncertain'))"];
	const bindings: (string | number)[] = [userId];
	if (folder !== 'all' && folder !== 'trash') filters.push('e.deleted_at IS NULL');
	if (!['all', 'spam', 'trash'].includes(folder)) filters.push('e.spam_at IS NULL');
	if (folder === 'inbox') filters.push("e.direction = 'inbound' AND e.archived_at IS NULL AND (e.snoozed_until IS NULL OR e.snoozed_until <= datetime('now'))");
	if (folder === 'sent') filters.push("e.direction = 'outbound'");
	if (folder === 'archive') filters.push('e.archived_at IS NOT NULL');
	if (folder === 'spam') filters.push('e.spam_at IS NOT NULL');
	if (folder === 'trash') filters.push('e.deleted_at IS NOT NULL');
	if (folder === 'starred') filters.push('e.is_starred = 1');
	const addressId = params.get('address');
	if (addressId) {
		const address = await db.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').bind(addressId, userId).first();
		if (!address) throw new MailTransferError('Address not found.', 404);
		filters.push('e.address_id = ?'); bindings.push(addressId);
	}
	let labelName: string | undefined;
	const labelId = params.get('label');
	if (labelId) {
		const label = await getLabel(db, userId, labelId);
		if (!label) throw new MailTransferError('Label not found.', 404);
		labelName = label.name;
		filters.push('EXISTS (SELECT 1 FROM email_labels el WHERE el.email_id = e.id AND el.label_id = ?)'); bindings.push(labelId);
	}
	const from = params.get('from');
	const to = params.get('to');
	for (const date of [from, to]) {
		if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
			throw new MailTransferError('Enter valid dates in YYYY-MM-DD format.');
		}
	}
	if (from && to && from > to) throw new MailTransferError('The start date must be on or before the end date.');
	if (from) { filters.push('datetime(e.created_at) >= datetime(?)'); bindings.push(from); }
	if (to) { filters.push("datetime(e.created_at) < datetime(?, '+1 day')"); bindings.push(to); }
	return { where: filters.join(' AND '), bindings, folder: folder as ExportFolder, labelName };
}

/** ZIP parts keep each download within Worker/D1 limits, without omitting a large mailbox. */
export async function prepareExport(db: D1Database, scope: Scope): Promise<ExportPart[]> {
	const { results } = await db.prepare(`SELECT e.rowid AS cursor, ${SIZE_SQL} AS bytes FROM emails e WHERE ${scope.where} ORDER BY e.rowid LIMIT 100001`)
		.bind(...scope.bindings).all<{ cursor: number; bytes: number }>();
	if (results.length > 100000) throw new MailTransferError('Export up to 100,000 messages at a time. Select a narrower date range.');
	const parts: ExportPart[] = [];
	let bytes = 0;
	for (const row of results) {
		let part = parts.at(-1);
		if (!part || part.count >= PART_SIZE || bytes + row.bytes > PART_BYTES) {
			part = { after: part?.through ?? 0, through: row.cursor, count: 0 };
			parts.push(part); bytes = 0;
		}
		part.through = row.cursor; part.count++; bytes += row.bytes;
	}
	return parts;
}

export async function validateExportPart(db: D1Database, scope: Scope, params: URLSearchParams): Promise<ExportPart> {
	const after = Number(params.get('after') ?? 0);
	const through = Number(params.get('through'));
	if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(through) || through <= after) throw new MailTransferError('Prepare the export before downloading.');
	const row = await db.prepare(`SELECT COUNT(*) AS count, SUM(${SIZE_SQL}) AS bytes FROM emails e WHERE ${scope.where} AND e.rowid > ? AND e.rowid <= ?`)
		.bind(...scope.bindings, after, through).first<{ count: number; bytes: number }>();
	if (!row?.count) throw new MailTransferError('No messages match this export.', 404);
	if (row.count > PART_SIZE || row.bytes > PART_BYTES) throw new MailTransferError('Prepare the export again to split it into ZIP parts.');
	return { after, through, count: row.count };
}

const encoder = new TextEncoder();
function clean(value: string | null | undefined): string { return (value ?? '').replace(/[\r\n\x00]/g, ' ').trim(); }
function encodedHeader(value: string): string {
	// Fold on code point boundaries so each RFC 2047 encoded word is independently valid UTF-8.
	const words: string[] = [];
	let chunk = '';
	for (const character of clean(value)) {
		if (encoder.encode(chunk + character).length > 42) { words.push(`=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`); chunk = ''; }
		chunk += character;
	}
	if (chunk) words.push(`=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`);
	return words.join('\r\n ');
}
function base64Lines(bytes: Uint8Array): string { return bytesToBase64(bytes).match(/.{1,76}/g)?.join('\r\n') ?? ''; }
function messageId(value: string): string { return `<${clean(value).replace(/[<>]/g, '')}>`; }
function safeName(value: string): string { return value.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/^\.+/, '_').trim().slice(0, 90) || 'message'; }

/** Stored messages without original MIME are reconstructed as standards-compatible EML. */
export async function* messageEml(bucket: R2Bucket, email: ExportEmail, attachments: Attachment[]): AsyncGenerator<Uint8Array> {
	if (email.raw_message_key) {
		const original = await bucket.get(email.raw_message_key);
		if (!original) throw new Error('The original EML file is missing from storage.');
		// Imports are bounded to 20 MB; keeping a single original in memory is bounded.
		yield new Uint8Array(await original.arrayBuffer());
		return;
	}
	const boundary = `qi-${crypto.randomUUID()}`;
	const alternative = `${boundary}-alt`;
	const headers = [
		`From: ${email.from_name ? `${encodedHeader(email.from_name)} <${clean(email.from_addr)}>` : clean(email.from_addr)}`,
		`To: ${clean(email.to_addr)}`,
		...(email.cc_addr ? [`Cc: ${clean(email.cc_addr)}`] : []),
		...(email.bcc_addr ? [`Bcc: ${clean(email.bcc_addr)}`] : []),
		`Subject: ${encodedHeader(email.subject)}`,
		`Date: ${new Date(email.created_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(email.created_at) ? '' : 'Z')).toUTCString()}`,
		`Message-ID: ${messageId(email.message_id || `${email.id}@quickinbox.local`)}`,
		...(email.in_reply_to ? [`In-Reply-To: ${messageId(email.in_reply_to)}`] : []),
		...(email.references_header ? [`References: ${clean(email.references_header)}`] : []),
		'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
		`--${boundary}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, ''
	];
	yield encoder.encode(headers.join('\r\n') + '\r\n');
	for (const [type, body] of [['text/plain', email.body_text ?? ''], ['text/html', email.body_html]] as const) {
		if (body === null) continue;
		yield encoder.encode(`--${alternative}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(encoder.encode(body))}\r\n`);
	}
	yield encoder.encode(`--${alternative}--\r\n`);
	for (const attachment of attachments) {
		const bytes = await readAttachmentBytes(bucket, attachment);
		if (!bytes) throw new Error(`Attachment “${attachment.filename}” is missing from storage.`);
		const filename = encodeURIComponent(clean(attachment.filename)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
		const disposition = attachment.content_disposition === 'inline' ? 'inline' : 'attachment';
		const contentId = normalizeContentId(attachment.content_id);
		const type = /^[\w.+-]+\/[\w.+-]+$/.test(attachment.content_type) ? attachment.content_type : 'application/octet-stream';
		yield encoder.encode(`--${boundary}\r\nContent-Type: ${type}\r\nContent-Disposition: ${disposition}; filename*=UTF-8''${filename}\r\n${contentId ? `Content-ID: <${contentId}>\r\n` : ''}Content-Transfer-Encoding: base64\r\n\r\n${base64Lines(bytes)}\r\n`);
	}
	yield encoder.encode(`--${boundary}--\r\n`);
}

function folderName(email: ExportEmail, scope: Scope): string {
	if (scope.labelName) return scope.labelName.split('/').map(safeName).join('/');
	if (email.deleted_at) return 'Trash';
	if (email.spam_at) return 'Spam';
	if (email.archived_at) return 'Archive';
	return email.direction === 'outbound' ? 'Sent' : 'Inbox';
}

export async function* exportZip(db: D1Database, bucket: R2Bucket, scope: Scope, part: ExportPart): AsyncGenerator<Uint8Array> {
	let chunks: Uint8Array[] = [];
	const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
	let cursor = part.after;
	let exported = 0;
	const failures: { file: string; error: string }[] = [];
	try {
		while (cursor < part.through) {
			const rows = await db.prepare(`SELECT e.*, e.rowid AS export_cursor FROM emails e
				WHERE ${scope.where} AND e.rowid > ? AND e.rowid <= ? ORDER BY e.rowid LIMIT 25`)
				.bind(...scope.bindings, cursor, part.through).all<ExportEmail>();
			if (!rows.results.length) break;
			const files = await db.prepare(`SELECT * FROM email_attachments WHERE email_id IN (${rows.results.map(() => '?').join(',')})`)
				.bind(...rows.results.map((row) => row.id)).all<Attachment>();
			for (const email of rows.results) {
				cursor = email.export_cursor;
				const name = `${folderName(email, scope)}/${safeName(email.subject)}-${email.id}.eml`;
				// Finish one EML before adding it to the ZIP. A missing part never produces a partial EML.
				const messageChunks: Uint8Array[] = [];
				try { for await (const data of messageEml(bucket, email, files.results.filter((file) => file.email_id === email.id))) messageChunks.push(data); }
				catch (error) { failures.push({ file: name, error: error instanceof Error ? error.message : 'Could not read message.' }); continue; }
				const file = new ZipPassThrough(name);
				zip.add(file);
				for (let i = 0; i < messageChunks.length; i++) {
					file.push(messageChunks[i], i === messageChunks.length - 1);
					for (const data of chunks) yield data;
					chunks = [];
				}
				exported++;
			}
		}
		const report = new ZipPassThrough('export-report.json');
		zip.add(report);
		report.push(encoder.encode(JSON.stringify({ format: 'quickinbox-eml-export', exported, expected: part.count,
			complete: failures.length === 0 && exported === part.count, failures, createdAt: new Date().toISOString(),
			note: 'Imported messages retain their original EML. Other messages are reconstructed from stored fields and attachments. Drafts and pending outbox messages are excluded. Dates are filtered in UTC. Read/starred state and labels are not encoded in EML.' }, null, 2)), true);
		zip.end();
		for (const data of chunks) yield data;
	} finally { zip.terminate(); }
}

export function exportZipStream(db: D1Database, bucket: R2Bucket, scope: Scope, part: ExportPart): ReadableStream<Uint8Array> {
	const iterator = exportZip(db, bucket, scope, part);
	return new ReadableStream({
		async pull(controller) {
			try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
			catch (error) { controller.error(error); await iterator.return(undefined); }
		},
		async cancel() { await iterator.return(undefined); }
	});
}
