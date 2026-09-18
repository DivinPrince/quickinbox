import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { bytesToBase64, readAttachmentBytes } from './attachments';

/** Explicit allowlist: login credentials, sessions, tokens and MFA secrets never leave the database. */
const TABLES = [
  { table: 'users', columns: 'id, email, name, is_admin, created_at' },
  { table: 'domains', columns: '*' },
  { table: 'addresses', columns: '*' },
  { table: 'labels', columns: '*' },
  { table: 'emails', columns: '*' },
  { table: 'email_labels', columns: '*' },
  { table: 'trusted_image_senders', columns: '*' },
  { table: 'unrouted_emails', columns: '*' },
  { table: 'email_attachments', columns: '*' }
] as const;

export async function* mailArchive(db: D1Database, bucket: R2Bucket): AsyncGenerator<string> {
  const counts: Record<string, number> = {};
  let missingAttachments = 0;
  yield JSON.stringify({ type: 'manifest', format: 'quickinbox-mail-archive', version: 1,
    createdAt: new Date().toISOString(), scope: 'All accounts: mail, attachments, addresses, domains, labels and image preferences. No login credentials. Not a transactional database snapshot.' }) + '\n';
  for (const { table, columns } of TABLES) {
    let cursor = 0;
    counts[table] = 0;
    // Freeze each table's upper bound so incoming mail cannot make the export infinite.
    const upper = await db.prepare(`SELECT MAX(rowid) AS last FROM ${table}`).first<{ last: number | null }>();
    while (upper?.last && cursor < upper.last) {
      const rows = await db.prepare(`SELECT rowid AS archive_cursor, ${columns} FROM ${table}
        WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`)
        .bind(cursor, upper.last, table === 'email_attachments' ? 1 : 25)
        .all<Record<string, unknown> & { archive_cursor: number }>();
      if (!rows.results.length) break;
      for (const row of rows.results) {
        const { archive_cursor, ...data } = row;
        cursor = archive_cursor;
        if (table === 'email_attachments') {
          const bytes = await readAttachmentBytes(bucket, {
            storage_key: typeof data.storage_key === 'string' ? data.storage_key : null,
            content_base64: typeof data.content_base64 === 'string' ? data.content_base64 : null
          });
          data.content_base64 = bytes ? bytesToBase64(bytes) : null;
          data.missing = !bytes;
          if (!bytes) missingAttachments++;
        }
        counts[table]++;
        yield JSON.stringify({ type: table, data }) + '\n';
      }
    }
  }
  // Consumers can detect truncated downloads by requiring this final record.
  yield JSON.stringify({ type: 'complete', counts, missingAttachments, finishedAt: new Date().toISOString() }) + '\n';
}

export function archiveStream(db: D1Database, bucket: R2Bucket): ReadableStream<Uint8Array> {
  const iterator = mailArchive(db, bucket);
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) { controller.error(error); await iterator.return(undefined); }
    },
    async cancel() { await iterator.return(undefined); }
  });
}
