import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Domain } from '$lib/types';

export type DnsCheck = { state: 'published' | 'missing' | 'unknown' | 'multiple'; records: string[] };
type DnsResponse = { Status?: number; Answer?: { type: number; data: string }[] };

export async function checkDns(name: string, type: 'MX' | 'TXT', prefix = '', request: (input: string, init?: RequestInit) => Promise<Response> = fetch): Promise<DnsCheck> {
  try {
    const response = await request(`https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name, type })}`, {
      headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { state: 'unknown', records: [] };
    const body = await response.json() as DnsResponse;
    if (body.Status !== 0 && body.Status !== 3) return { state: 'unknown', records: [] };
    const records = (body.Answer ?? []).filter((row) => row.type === (type === 'MX' ? 15 : 16))
      .map((row) => row.data.replace(/"\s*"/g, '').replace(/^"|"$/g, ''))
      .filter((value) => !prefix || value.toLowerCase().startsWith(prefix.toLowerCase()));
    return { state: !records.length ? 'missing' : type === 'TXT' && prefix && records.length > 1 ? 'multiple' : 'published', records };
  } catch { return { state: 'unknown', records: [] }; }
}

export async function checkDomain(domain: Domain) {
  const [mx, spf, dmarc] = await Promise.all([
    checkDns(domain.name, 'MX'), checkDns(domain.name, 'TXT', 'v=spf1'),
    checkDns(`_dmarc.${domain.name}`, 'TXT', 'v=DMARC1')
  ]);
  return { ...domain, mx, spf, dmarc };
}

export async function readMaintenance(db: D1Database, bucket: R2Bucket) {
  const [mail, attachments, jobs, events, failures, unrouted, lastRun, storage] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS messages,
      MAX(CASE WHEN direction = 'inbound' THEN created_at END) AS last_inbound,
      MAX(CASE WHEN direction = 'outbound' AND status IN ('accepted', 'sent', 'delivered') THEN created_at END) AS last_outbound
      FROM emails`).all<{ messages: number; last_inbound: string | null; last_outbound: string | null }>(),
    db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM email_attachments')
      .first<{ files: number; bytes: number }>(),
    db.prepare('SELECT state, COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes FROM outbox_jobs GROUP BY state')
      .all<{ state: string; count: number; bytes: number }>(),
    db.prepare("SELECT id, kind, detail, created_at FROM operational_events WHERE created_at >= datetime('now', '-30 days') ORDER BY created_at DESC LIMIT 25")
      .all<{ id: string; kind: string; detail: string; created_at: string }>(),
    db.prepare(`SELECT e.id, e.subject, e.status, e.status_detail, e.status_at, u.email AS owner
      FROM emails e JOIN users u ON u.id = e.user_id WHERE e.direction = 'outbound'
      AND e.status IN ('failed', 'bounced', 'uncertain') ORDER BY e.status_at DESC LIMIT 25`)
      .all<{ id: string; subject: string; status: string; status_detail: string | null; status_at: string | null; owner: string }>(),
    db.prepare('SELECT COUNT(*) AS count FROM unrouted_emails').first<{ count: number }>(),
    db.prepare("SELECT value FROM maintenance_state WHERE key = 'outbox_last_run'").first<{ value: string }>(),
    bucket.list({ limit: 1 }).then(() => true).catch(() => false)
  ]);
  return {
    mail: mail.results[0], databaseBytes: mail.meta.size_after,
    attachments: attachments ?? { files: 0, bytes: 0 }, jobs: jobs.results,
    events: events.results, failures: failures.results, unrouted: unrouted?.count ?? 0,
    outboxLastRun: lastRun?.value ?? null,
    outboxWorkerHealthy: Boolean(lastRun && Date.now() - Date.parse(lastRun.value) < 5 * 60_000),
    storageAvailable: storage
  };
}
