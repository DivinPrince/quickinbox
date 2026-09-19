<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { APP_NAME } from '$lib/constants';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let busy = $state('');
  let error = $state('');
  let confirmed = $state<Record<string, boolean>>({});
  async function retry(id: string) {
    busy = id;
    error = '';
    try {
      const response = await fetch(`/api/outbox/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDuplicateRisk: confirmed[id] === true })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? t('outbox.retryError'));
      confirmed = {};
      await invalidateAll();
    } catch (cause) { error = cause instanceof Error ? cause.message : t('common.networkError'); }
    finally { busy = ''; }
  }
</script>

<svelte:head><title>{t('nav.outbox')} — {APP_NAME}</title></svelte:head>

<div class="outbox-page">
  <header><div><h1>{t('nav.outbox')}</h1><p>{t('outbox.hint')}</p></div><button class="btn-ghost" type="button" onclick={() => invalidateAll()}>{t('outbox.refresh')}</button></header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !data.jobs.length}<div class="surface-lg empty">{t('outbox.empty')}</div>{/if}
  {#each data.jobs as job (job.id)}
    <article class="surface-lg job">
      <div class="job-heading">
        <div>
          {#if job.email_id}<a class="subject" href={`/mail/${job.email_id}`}>{job.subject || t('mailbox.noSubject')}</a>
          {:else}<span class="subject">{t('outbox.incomplete')}</span>{/if}
          <p>{job.to_addr ?? '—'}</p>
        </div>
        <span class="badge" class:attention={job.state === 'failed' || job.state === 'uncertain'}>{t(`outbox.states.${job.state}`)}</span>
      </div>
      <p class="meta">{job.created_at} UTC · {t('outbox.attempts', { count: job.attempts })}</p>
      {#if job.last_error}<p class="detail">{job.last_error}</p>{/if}
      {#if job.state === 'retry'}<p class="meta">{t('outbox.nextRetry', { time: new Date(job.next_attempt_at).toLocaleString() })}</p>{/if}
      {#if job.prepared && ['failed', 'uncertain', 'retry'].includes(job.state)}
        <div class="retry">
          {#if job.confirmDuplicateRisk}<label><input type="checkbox" bind:checked={confirmed[job.id]} /> {t('outbox.confirmDuplicate')}</label>{/if}
          <button type="button" class="btn-primary" disabled={Boolean(busy) || (job.confirmDuplicateRisk && !confirmed[job.id])} onclick={() => retry(job.id)}>{busy === job.id ? t('outbox.retrying') : t('outbox.retry')}</button>
        </div>
      {/if}
    </article>
  {/each}
  {#if data.jobs.length}<p class="meta">{t('outbox.limit')}</p>{/if}
</div>

<style>
  .outbox-page { width: 100%; max-width: 1000px; margin: 0 auto; padding: clamp(1rem, 3vw, 2rem); overflow: auto; }
  header, .job-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; font-weight: 650; }
  p { color: var(--color-text-secondary); margin-top: .4rem; font-size: .875rem; overflow-wrap: anywhere; }
  .job { padding: 1.25rem; margin-bottom: 1rem; border: 1px solid var(--color-line); border-radius: .75rem; }
  .subject { font-weight: 600; overflow-wrap: anywhere; }
  a.subject:hover { text-decoration: underline; }
  .badge { flex-shrink: 0; padding: .2rem .6rem; border-radius: 1rem; background: var(--color-surface-muted); font-size: .75rem; }
  .attention, .error { color: var(--tone-warn-fg); }
  .meta { font-size: .75rem; }
  .retry { display: flex; align-items: center; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; }
  label { display: flex; gap: .5rem; font-size: .8rem; max-width: 600px; }
  input { flex-shrink: 0; }
  .empty { padding: 2rem; text-align: center; color: var(--color-text-secondary); }
  @media (max-width: 600px) { .job-heading { flex-direction: column; } }
</style>
