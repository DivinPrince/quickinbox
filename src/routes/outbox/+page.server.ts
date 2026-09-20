import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { OutboxState } from '$lib/server/durable-outbox';

export const load: PageServerLoad = async ({ locals, platform, setHeaders }) => {
  setHeaders({ 'Cache-Control': 'private, no-store' });
  if (!locals.user || !platform?.env.DB) throw error(401, 'Unauthorized');
  const rows = await platform.env.DB.prepare(`SELECT j.id, j.state, j.prepared, j.attempts,
    j.last_error, j.created_at, j.next_attempt_at, j.first_attempt_at, j.provider,
    e.subject, e.to_addr, e.id AS email_id FROM outbox_jobs j
    LEFT JOIN emails e ON e.id = j.email_id WHERE j.user_id = ? AND j.state != 'accepted'
    ORDER BY j.created_at DESC LIMIT 100`)
    .bind(locals.user.id).all<{
      id: string; state: OutboxState; prepared: number; attempts: number;
      last_error: string | null; created_at: string; next_attempt_at: number;
      first_attempt_at: number | null; provider: string;
      subject: string | null; to_addr: string | null; email_id: string | null;
    }>();
  return { jobs: rows.results.map((job) => ({ ...job,
    confirmDuplicateRisk: job.state === 'uncertain' ||
      (job.provider === 'resend' && job.first_attempt_at !== null && Date.now() - job.first_attempt_at >= 23 * 60 * 60_000)
  })) };
};
