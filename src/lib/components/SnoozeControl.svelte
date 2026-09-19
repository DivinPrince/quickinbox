<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { runMailAction } from '$lib/mail/client';
  import { t } from '$lib/i18n';
  let { ids, snoozed = false, onDone }: { ids: string[]; snoozed?: boolean; onDone?: () => void } = $props();
  let open = $state(false);
  let date = $state('');
  let busy = $state(false);
  function focusPicker(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.querySelector<HTMLButtonElement>('button')?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const controls = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const next = event.shiftKey ? controls.at(-1) : controls[0];
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next?.focus(); }
    }
    node.addEventListener('keydown', trap);
    return { destroy() { node.removeEventListener('keydown', trap); previous?.focus(); } };
  }
  function choose() {
    const time = new Date(Date.now() + 4 * 3600_000);
    date = new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    open = true;
  }
  async function snooze(until?: Date) {
    busy = true;
    try { await runMailAction(until ? 'snooze' : 'unsnooze', ids, until ? { until: until.toISOString() } : {}); open = false; await invalidateAll(); onDone?.(); }
    catch { /* The shared notice offers retry without dismissing this picker. */ }
    finally { busy = false; }
  }
  function tomorrow() { const time = new Date(); time.setDate(time.getDate() + 1); time.setHours(9, 0, 0, 0); return time; }
</script>
<button type="button" class="btn-ghost snooze-trigger" disabled={!ids.length || busy} onclick={choose}>{t('cleanup.snooze')}</button>
{#if snoozed}<button type="button" class="btn-ghost" disabled={!ids.length || busy} onclick={() => snooze()}>{t('cleanup.wakeNow')}</button>{/if}
{#if open}
  <div class="snooze-scrim" role="presentation">
    <div class="picker" use:focusPicker role="dialog" aria-modal="true" aria-label={t('cleanup.snooze')} tabindex="-1" onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !busy) open = false; }}>
      <h2>{t('cleanup.snooze')}</h2><p>{t('cleanup.snoozeHint')}</p>
      <div class="presets"><button class="btn-ghost" type="button" disabled={busy} onclick={() => snooze(new Date(Date.now() + 4 * 3600_000))}>{t('cleanup.later')}</button><button class="btn-ghost" type="button" disabled={busy} onclick={() => snooze(tomorrow())}>{t('cleanup.tomorrow')}</button></div>
      <label>{t('cleanup.chooseTime')}<input type="datetime-local" bind:value={date} /></label>
      <div class="presets"><button class="btn-primary" type="button" disabled={busy || !date} onclick={() => snooze(new Date(date))}>{t('cleanup.snooze')}</button><button class="btn-ghost" type="button" disabled={busy} onclick={() => { open = false; }}>{t('common.cancel')}</button></div>
    </div>
  </div>
{/if}
<style>
  .snooze-trigger { font-size: .75rem; white-space: nowrap; }.snooze-scrim { position: fixed; inset: 0; z-index: 95; background: #0006; display: grid; place-items: center; padding: 1rem; }
  .picker { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-line); padding: 1.5rem; border-radius: 1rem; width: 360px; max-width: 100%; box-shadow: 0 12px 50px #0003; }
  h2 { font-size: 1.1rem; font-weight: 600; }p, label { font-size: .8rem; margin: .7rem 0; }label { display: flex; flex-direction: column; gap: .4rem; }input { border: 1px solid var(--color-line); border-radius: .4rem; padding: .6rem; color: inherit; background: var(--color-surface); }
  .presets { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .8rem; }
</style>
