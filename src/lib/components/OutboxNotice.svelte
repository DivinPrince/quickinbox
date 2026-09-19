<script lang="ts">
  import { t } from '$lib/i18n';
  let state = $state('');
  function onQueued(event: Event) {
    const detail = (event as CustomEvent<{ state: string }>).detail;
    state = detail.state === 'accepted' ? '' : detail.state;
  }
  $effect(() => {
    window.addEventListener('mail:outbox', onQueued);
    return () => window.removeEventListener('mail:outbox', onQueued);
  });
</script>

{#if state}
  <div class="outbox-notice" role="status">
    <span>{t('outbox.savedNotice')} {t(`outbox.states.${state}`)}.</span>
    <a href="/outbox">{t('nav.outbox')}</a>
    <button type="button" aria-label={t('common.close')} onclick={() => { state = ''; }}>×</button>
  </div>
{/if}

<style>
  .outbox-notice { position: fixed; z-index: 100; left: 50%; bottom: calc(5rem + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: center; gap: .8rem; width: max-content; max-width: calc(100vw - 2rem); padding: .8rem 1rem; border: 1px solid var(--color-line); border-radius: .75rem; background: var(--color-surface); color: var(--color-text); box-shadow: 0 5px 25px #0002; font-size: .8rem; }
  a { text-decoration: underline; }
  button { font-size: 1.3rem; cursor: pointer; }
</style>
