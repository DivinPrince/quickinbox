import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailAttachmentMeta, OutboundAttachmentInput } from '$lib/types';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from './constants';

type StoredAttachmentRow = EmailAttachmentMeta & {
	storage_key: string | null;
	content_base64: string | null;
};

export async function insertAttachments(
	db: D1Database,
	bucket: R2Bucket,
	emailId: string,
	attachments: OutboundAttachmentInput[],
	options: { enforceCountLimit?: boolean } = {}
): Promise<void> {
	if (attachments.length === 0) return;
	if (options.enforceCountLimit !== false && attachments.length > MAX_ATTACHMENTS_PER_EMAIL) {
		throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_EMAIL} attachments allowed`);
	}

	for (const attachment of attachments) {
		const bytes = base64ToBytes(attachment.content);
		if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
			const limitMb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
			throw new Error(`"${attachment.filename}" exceeds ${limitMb}MB limit`);
		}

		const id = crypto.randomUUID();
		const storageKey = buildStorageKey(emailId, id, attachment.filename);

		await bucket.put(storageKey, bytes, {
			httpMetadata: { contentType: attachment.type },
			customMetadata: { filename: attachment.filename }
		});

		await db
			.prepare(
				`INSERT INTO email_attachments (
					id, email_id, filename, content_type, size_bytes, content_base64, storage_key
				) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				emailId,
				attachment.filename,
				attachment.type,
				bytes.byteLength,
				'',
				storageKey
			)
			.run();
	}
}

export async function insertAttachmentBytes(
	db: D1Database,
	bucket: R2Bucket,
	emailId: string,
	input: { filename: string; type: string; bytes: Uint8Array }
): Promise<void> {
	if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
		const limitMb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
		throw new Error(`"${input.filename}" exceeds ${limitMb}MB limit`);
	}

	const id = crypto.randomUUID();
	const storageKey = buildStorageKey(emailId, id, input.filename);

	await bucket.put(storageKey, input.bytes, {
		httpMetadata: { contentType: input.type },
		customMetadata: { filename: input.filename }
	});

	await db
		.prepare(
			`INSERT INTO email_attachments (
				id, email_id, filename, content_type, size_bytes, content_base64, storage_key
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(id, emailId, input.filename, input.type, input.bytes.byteLength, '', storageKey)
		.run();
}

/**
 * The stored parts of a message in the shape an outbound send takes.
 *
 * Forwarding carries the original's files with it, and those already live in
 * R2 — so they are read back here rather than being uploaded again from the
 * browser. A part whose bytes have gone missing is skipped: losing one file is
 * better than failing the forward.
 */
export async function readOutboundAttachments(
	db: D1Database,
	bucket: R2Bucket,
	userId: string,
	emailId: string
): Promise<OutboundAttachmentInput[]> {
	const { results } = await db
		.prepare(
			`SELECT a.id, a.email_id, a.filename, a.content_type, a.size_bytes,
			        a.storage_key, a.content_base64, a.created_at
			 FROM email_attachments a
			 JOIN emails e ON e.id = a.email_id
			 WHERE a.email_id = ? AND e.user_id = ?
			 ORDER BY a.created_at ASC`
		)
		.bind(emailId, userId)
		.all<StoredAttachmentRow>();

	const attachments: OutboundAttachmentInput[] = [];

	for (const row of results) {
		const bytes = await readAttachmentBytes(bucket, row);
		if (!bytes) continue;

		attachments.push({
			filename: row.filename,
			type: row.content_type,
			content: bytesToBase64(bytes)
		});
	}

	return attachments;
}

export async function listAttachments(
	db: D1Database,
	emailId: string
): Promise<EmailAttachmentMeta[]> {
	const { results } = await db
		.prepare(
			`SELECT id, email_id, filename, content_type, size_bytes, created_at
			 FROM email_attachments
			 WHERE email_id = ?
			 ORDER BY created_at ASC`
		)
		.bind(emailId)
		.all<EmailAttachmentMeta>();

	return results;
}

export async function getAttachmentForUser(
	db: D1Database,
	userId: string,
	emailId: string,
	attachmentId: string
): Promise<StoredAttachmentRow | null> {
	const row = await db
		.prepare(
			`SELECT a.id, a.email_id, a.filename, a.content_type, a.size_bytes, a.storage_key, a.content_base64, a.created_at
			 FROM email_attachments a
			 JOIN emails e ON e.id = a.email_id
			 WHERE a.id = ? AND a.email_id = ? AND e.user_id = ?`
		)
		.bind(attachmentId, emailId, userId)
		.first<StoredAttachmentRow>();

	return row ?? null;
}

export async function readAttachmentBytes(
	bucket: R2Bucket,
	attachment: StoredAttachmentRow
): Promise<Uint8Array | null> {
	if (attachment.storage_key) {
		const object = await bucket.get(attachment.storage_key);
		if (!object) return null;
		return new Uint8Array(await object.arrayBuffer());
	}

	if (attachment.content_base64) {
		return base64ToBytes(attachment.content_base64);
	}

	return null;
}

function buildStorageKey(emailId: string, attachmentId: string, filename: string): string {
	const safeName = filename.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 120) || 'attachment';
	return `${emailId}/${attachmentId}/${safeName}`;
}

function base64ToBytes(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * Providers take attachments as base64. Converted in chunks because spreading a
 * whole file into `fromCharCode` overruns the call stack once it is big enough.
 */
function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}

	return btoa(binary);
}

function base64ByteLength(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

export { base64ToBytes, base64ByteLength, bytesToBase64 };
