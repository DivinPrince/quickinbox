<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n';
  let busy = $state('');
  let error = $state('');
  const senders = $derived(($page.data.trustedImageSenders ?? []) as string[]);
  async function revoke(sender: string) {
    busy = sender;
    error = '';
    try {
      const response = await fetch('/api/settings/remote-images', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender })
      });
      if (!response.ok) throw new Error(t('privacy.saveError'));
      await invalidateAll();
    } catch { error = t('privacy.saveError'); }
    finally { busy = ''; }
  }
</script>

<section class="surface-lg privacy-card">
  <h2>{t('privacy.title')}</h2>
  <p>{t('privacy.settingsHint')}</p>
  {#if senders.length === 0}
    <p>{t('privacy.noTrustedSenders')}</p>
  {:else}
    <ul>
      {#each senders as sender (sender)}
        <li><span>{sender}</span><button class="btn-ghost" type="button" disabled={Boolean(busy)} onclick={() => revoke(sender)}>{t('privacy.blockSender')}</button></li>
      {/each}
    </ul>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>

<style>
  .privacy-card { padding: 1.5rem; margin-bottom: 1.25rem; }
  h2 { font-size: 1rem; font-weight: 600; margin-bottom: .5rem; }
  p { color: var(--color-text-secondary); font-size: .875rem; margin: .5rem 0; }
  ul { list-style: none; padding: 0; margin-top: 1rem; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 0; }
  li span { overflow-wrap: anywhere; }
</style>
