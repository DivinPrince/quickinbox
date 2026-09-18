import type { D1Database } from '@cloudflare/workers-types';

/** Diagnostics must never turn an ingestion failure into a lost retry. */
export async function recordOperationalFailure(
  db: D1Database,
  kind: 'inbound' | 'outbound' | 'system',
  detail: string
): Promise<void> {
  try {
    await db.prepare('INSERT INTO operational_events (id, kind, detail) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), kind, detail.slice(0, 500)).run();
  } catch {
    console.error('Could not persist operational event', kind);
  }
}
