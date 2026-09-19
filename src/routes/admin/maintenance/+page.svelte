<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { APP_NAME } from '$lib/constants';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let refreshing = $state(false);
  let refreshError = $state(false);
  const pending = $derived(data.health.jobs.filter((job) => ['preparing', 'pending', 'retry', 'sending'].includes(job.state)).reduce((total, job) => total + job.count, 0));
  const payloadBytes = $derived(data.health.jobs.reduce((total, job) => total + job.bytes, 0));
  function bytes(value: number | undefined) {
    if (value === undefined) return t('maintenance.unknown');
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }
  async function refresh() {
    refreshing = true; refreshError = false;
    try { await invalidateAll(); } catch { refreshError = true; }
    finally { refreshing = false; }
  }
</script>

<svelte:head><title>{t('nav.maintenance')} — {APP_NAME}</title></svelte:head>

<div class="maintenance">
  <header><div><h1>{t('nav.maintenance')}</h1><p>{t('maintenance.hint')}</p></div><button type="button" class="btn-ghost" disabled={refreshing} onclick={refresh}>{refreshing ? t('maintenance.checking') : t('maintenance.refresh')}</button></header>
  {#if refreshError}<p role="alert">{t('common.networkError')}</p>{/if}
  <div class="stats">
    <article class="surface-lg"><span>{t('maintenance.messages')}</span><strong>{data.health.mail.messages.toLocaleString()}</strong></article>
    <article class="surface-lg"><span>{t('maintenance.database')}</span><strong>{bytes(data.health.databaseBytes)}</strong></article>
    <article class="surface-lg"><span>{t('maintenance.attachments')}</span><strong>{bytes(data.health.attachments.bytes)}</strong><small>{t('maintenance.files', { count: data.health.attachments.files })}</small></article>
    <article class="surface-lg"><span>{t('maintenance.pending')}</span><strong>{pending}</strong><a href="/outbox">{t('maintenance.myOutbox')}</a></article>
  </div>
  <section class="surface-lg">
    <h2>{t('maintenance.services')}</h2>
    <dl>
      <div><dt>{t('maintenance.provider')}</dt><dd>{data.provider === 'cloudflare' ? 'Cloudflare Email' : 'Resend'} · {t(data.providerConfigured ? 'maintenance.configured' : 'maintenance.needsSetup')}</dd></div>
      {#if data.provider === 'resend'}<div><dt>{t('maintenance.webhook')}</dt><dd>{t(data.webhookConfigured ? 'maintenance.configured' : 'maintenance.needsSetup')}</dd></div>{/if}
      <div><dt>{t('maintenance.storage')}</dt><dd>{t(data.health.storageAvailable ? 'maintenance.available' : 'maintenance.unavailable')}</dd></div>
      <div><dt>{t('maintenance.worker')}</dt><dd class:warning={!data.health.outboxWorkerHealthy}>{t(data.health.outboxWorkerHealthy ? 'maintenance.running' : 'maintenance.workerMissing')}</dd></div>
      <div><dt>{t('maintenance.workerLastRun')}</dt><dd>{data.health.outboxLastRun ? new Date(data.health.outboxLastRun).toLocaleString() : t('maintenance.never')}</dd></div>
      <div><dt>{t('maintenance.lastInbound')}</dt><dd>{data.health.mail.last_inbound ? `${data.health.mail.last_inbound} UTC` : t('maintenance.never')}</dd></div>
      <div><dt>{t('maintenance.lastOutbound')}</dt><dd>{data.health.mail.last_outbound ? `${data.health.mail.last_outbound} UTC` : t('maintenance.never')}</dd></div>
      <div><dt>{t('maintenance.unrouted')}</dt><dd><a href="/admin">{data.health.unrouted}</a></dd></div>
      <div><dt>{t('maintenance.savedPayloads')}</dt><dd>{bytes(payloadBytes)}</dd></div>
    </dl>
    <p class="hint">{t('maintenance.storageHint')}</p>
  </section>
  <section class="surface-lg">
    <h2>{t('maintenance.domains')}</h2>
    <p class="hint">{t('maintenance.dnsHint')}</p>
    {#if !data.domains.length}<p>{t('maintenance.noDomains')}</p>{/if}
    {#each data.domains as domain (domain.id)}
      <article class="domain">
        <h3>{domain.name}</h3>
        <p class="hint">{t('maintenance.domainConfig', { send: t(domain.sending_enabled ? 'maintenance.enabled' : 'maintenance.disabled'), receive: t(domain.receiving_enabled ? 'maintenance.enabled' : 'maintenance.disabled') })}</p>
        <dl>
          {#each [{ name: 'MX', result: domain.mx }, { name: 'SPF', result: domain.spf }, { name: 'DMARC', result: domain.dmarc }] as check}
            <div><dt>{check.name}</dt><dd><span class:warning={check.result.state !== 'published'}>{t(`maintenance.dns.${check.result.state}`)}</span>{#each check.result.records as record}<code>{record}</code>{/each}</dd></div>
          {/each}
          <div><dt>DKIM</dt><dd><a href={data.provider === 'cloudflare' ? 'https://dash.cloudflare.com/' : 'https://resend.com/domains'} target="_blank" rel="noreferrer">{t('maintenance.verifyDkim')}</a></dd></div>
        </dl>
      </article>
    {/each}
    {#if data.pages > 1}<nav class="pager" aria-label={t('maintenance.domains')}>{#if data.domainPage > 1}<a href={`?domainPage=${data.domainPage - 1}`}>← {t('maintenance.previous')}</a>{/if}<span>{data.domainPage} / {data.pages}</span>{#if data.domainPage < data.pages}<a href={`?domainPage=${data.domainPage + 1}`}>{t('maintenance.next')} →</a>{/if}</nav>{/if}
  </section>
  <section class="surface-lg">
    <h2>{t('maintenance.failures')}</h2>
    {#if !data.health.failures.length}<p class="hint">{t('maintenance.noFailures')}</p>{/if}
    {#each data.health.failures as failure (failure.id)}<article class="event"><strong>{failure.subject || t('mailbox.noSubject')}</strong><p>{failure.owner} · {t(`delivery.${failure.status}`)}</p>{#if failure.status_detail}<p>{failure.status_detail}</p>{/if}<small>{failure.status_at ? `${failure.status_at} UTC` : t('maintenance.never')}</small></article>{/each}
    <h3>{t('maintenance.processingEvents')}</h3>
    <p class="hint">{t('maintenance.eventsHint')}</p>
    {#if !data.health.events.length}<p class="hint">{t('maintenance.noEvents')}</p>{/if}
    {#each data.health.events as event (event.id)}<article class="event"><strong>{t(`maintenance.kinds.${event.kind}`)}</strong><p>{event.detail}</p><small>{event.created_at} UTC</small></article>{/each}
  </section>
  <section class="surface-lg">
    <h2>{t('maintenance.backups')}</h2>
    <p>{t('maintenance.exportHint')}</p>
    <a class="btn-primary download" href="/api/admin/export" download data-sveltekit-reload>{t('maintenance.download')}</a>
    <p class="hint">{t('maintenance.exportLimit')}</p>
    <details><summary>{t('maintenance.fullBackup')}</summary><p>{t('maintenance.backupHint')}</p><pre><code>npx wrangler d1 export DB --remote --output=quickinbox-database.sql</code></pre><p>{t('maintenance.bucketBackup')}</p><div class="links"><a href="https://developers.cloudflare.com/d1/best-practices/import-export-data/" target="_blank" rel="noreferrer">{t('maintenance.databaseGuide')}</a><a href="https://developers.cloudflare.com/r2/examples/rclone/" target="_blank" rel="noreferrer">{t('maintenance.storageGuide')}</a></div></details>
  </section>
  <p class="hint">{t('maintenance.checked', { time: new Date(data.checkedAt).toLocaleString() })}</p>
</div>

<style>
  .maintenance { max-width: 1100px; margin: 0 auto; padding: clamp(1rem, 3vw, 2rem); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1.5rem; }
  header button { flex-shrink: 0; white-space: nowrap; }
  h1 { font-size: 1.5rem; font-weight: 650; }
  h2 { font-size: 1rem; font-weight: 600; margin-bottom: .8rem; }
  h3 { font-size: .9rem; font-weight: 600; margin: .5rem 0; }
  p { margin: .5rem 0; font-size: .875rem; color: var(--color-text-secondary); overflow-wrap: anywhere; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1.25rem; }
  .stats article { display: flex; flex-direction: column; padding: 1.2rem; gap: .5rem; }
  .stats span, .stats small, .stats a { font-size: .75rem; color: var(--color-text-secondary); }
  .stats strong { font-size: 1.5rem; font-weight: 650; }
  section { padding: 1.5rem; margin-bottom: 1.25rem; border: 1px solid var(--color-line); border-radius: .75rem; }
  dl { margin: .5rem 0; }
  dl > div { display: grid; grid-template-columns: minmax(110px, 30%) minmax(0, 1fr); gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--color-line); font-size: .8rem; }
  dt, small, .hint { color: var(--color-text-secondary); }
  dd { overflow-wrap: anywhere; }
  .domain, .event { padding: .9rem 0; border-top: 1px solid var(--color-line); }
  .event strong { font-size: .85rem; overflow-wrap: anywhere; }
  small, .hint { font-size: .75rem; line-height: 1.5; }
  code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .75rem; margin-top: .4rem; }
  .warning { color: var(--tone-warn-fg); }
  a:not(.btn-primary) { text-decoration: underline; text-underline-offset: 3px; }
  .download { display: inline-flex; margin: .75rem 0; }
  summary { cursor: pointer; font-weight: 500; font-size: .875rem; margin-top: 1rem; }
  pre { padding: 1rem; border-radius: .5rem; background: var(--color-surface-muted); }
  .links, .pager { display: flex; flex-wrap: wrap; gap: 1rem; font-size: .8rem; margin-top: 1rem; }
  @media (max-width: 750px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } section { padding: 1rem; } }
</style>
