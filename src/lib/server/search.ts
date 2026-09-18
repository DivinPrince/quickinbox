import type { D1Database } from '@cloudflare/workers-types';
export function searchTerms(query: string): string[] { return (query.slice(0, 500).match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 20); }
export function ftsQuery(query: string): string { return searchTerms(query).map((term) => `"${term}"*`).join(' AND '); }
export function searchFilters(params: URLSearchParams) {
  const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : '';
  return { q: (params.get('q') ?? '').trim().slice(0, 500), from: (params.get('from') ?? '').trim().slice(0, 320),
    to: (params.get('to') ?? '').trim().slice(0, 320), after: date(params.get('after')), before: date(params.get('before')),
    attachments: params.get('attachments') === '1', includeHidden: params.get('hidden') === '1' };
}
export type SearchFilters = ReturnType<typeof searchFilters>;
export type SearchResult = { id: string; subject: string; from_addr: string; to_addr: string; created_at: string; status: string | null; excerpt: string; has_attachments: number };
export async function searchMail(db: D1Database, userId: string, filters: SearchFilters, page = 1, domainId?: string | null) {
  const match = ftsQuery(filters.q);
  const where = ['e.user_id = ?'];
  const values: (string | number)[] = [userId];
  if (!filters.includeHidden) where.push('e.deleted_at IS NULL AND e.spam_at IS NULL');
  if (domainId) { where.push('e.domain_id = ?'); values.push(domainId); }
  if (match) { where.push('email_search MATCH ?'); values.push(match); }
  else if (filters.q) where.push('0 = 1');
  const like = (value: string) => `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  if (filters.from) { where.push("e.from_addr LIKE ? ESCAPE '\\'"); values.push(like(filters.from)); }
  if (filters.to) { where.push("(e.to_addr LIKE ? ESCAPE '\\' OR e.cc_addr LIKE ? ESCAPE '\\' OR e.bcc_addr LIKE ? ESCAPE '\\')"); values.push(...Array(3).fill(like(filters.to))); }
  if (filters.after) { where.push('e.created_at >= ?'); values.push(`${filters.after} 00:00:00`); }
  if (filters.before) { where.push('e.created_at <= ?'); values.push(`${filters.before} 23:59:59`); }
  if (filters.attachments) where.push('(e.draft_attachment_count > 0 OR EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id))');
  const source = `FROM emails e ${match ? 'JOIN email_search ON email_search.rowid = e.rowid' : ''} WHERE ${where.join(' AND ')}`;
  const total = (await db.prepare(`SELECT COUNT(*) AS n ${source}`).bind(...values).first<{ n: number }>())?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  const current = Math.max(1, Math.min(pages, Math.floor(Number.isFinite(page) ? page : 1)));
  const rows = await db.prepare(`SELECT e.id, e.subject, e.from_addr, e.to_addr, e.created_at, e.status,
    ${match ? "snippet(email_search, 4, '', '', ' … ', 32)" : "substr(COALESCE(e.body_text, ''), 1, 220)"} AS excerpt,
    (e.draft_attachment_count > 0 OR EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)) AS has_attachments
    ${source} ORDER BY ${match ? 'email_search.rank,' : ''} e.created_at DESC, e.id LIMIT 25 OFFSET ?`).bind(...values, (current - 1) * 25).all<SearchResult>();
  return { results: rows.results, total, page: current, pages };
}
