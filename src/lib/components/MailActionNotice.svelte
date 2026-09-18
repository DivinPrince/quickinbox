<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n';
  import type { MailActionNotice } from '$lib/mail/client';
  let notice = $state<MailActionNotice | null>(null);
  let busy = $state(false);
  let message = $state('');
  $effect(() => {
    const receive = (event: Event) => { notice = (event as CustomEvent<MailActionNotice>).detail; message = ''; };
    window.addEventListener('mail:action', receive);
    return () => window.removeEventListener('mail:action', receive);
  });
  async function run() {
    if (!notice || busy) return;
    busy = true;
    const current = notice;
    try {
      if (current.retry) { await current.retry(); if (notice === current) { notice = null; message = t('cleanup.updated'); } }
      else if (current.undoId) {
        const response = await fetch('/api/mail/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.undoId }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t('cleanup.undoFailed'));
        notice = null;
        message = body.affected ? t('cleanup.undone') : t('cleanup.changed');
      }
      await invalidateAll();
    } catch (error) { message = error instanceof Error ? error.message : t('common.networkError'); }
    finally { busy = false; }
  }
</script>
{#if notice || message}
  <div class="action-notice" role="status" aria-live="polite">
    <span>{message || notice?.error || t(`cleanup.done.${notice?.action}`)}</span>
    {#if notice?.undoId || notice?.retry}<button type="button" disabled={busy} onclick={run}>{t(notice.retry ? 'cleanup.retry' : 'cleanup.undo')}</button>{/if}
    <button type="button" aria-label={t('common.close')} onclick={() => { notice = null; message = ''; }}>×</button>
  </div>
{/if}
<style>
  .action-notice { position: fixed; z-index: 110; left: 50%; bottom: calc(5rem + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: center; gap: 1rem; width: max-content; max-width: calc(100vw - 2rem); padding: .8rem 1rem; border: 1px solid var(--color-line); border-radius: .7rem; background: var(--color-surface); color: var(--color-text); box-shadow: 0 5px 25px #0002; font-size: .85rem; }
  button { text-decoration: underline; white-space: nowrap; }
</style>
