<script lang="ts">
  import { t } from '$lib/i18n';
  import type { MailLabel } from '$lib/types';
  import type { SenderRule } from '$lib/server/sender-rules';
  let { labels }: { labels: MailLabel[] } = $props();
  let rules = $state<SenderRule[]>([]);
  let sender = $state(''); let subject = $state(''); let label = $state(''); let archive = $state(true);
  let busy = $state(false); let error = $state(''); let loaded = $state(false);
  async function load() {
    try { const response = await fetch('/api/settings/sender-rules'); if (!response.ok) throw new Error(t('rules.failed')); rules = (await response.json()).rules; loaded = true; error = ''; }
    catch { error = t('rules.failed'); }
  }
  $effect(() => { void load(); });
  async function save(rule?: SenderRule) {
    busy = true; error = '';
    try {
      const response = await fetch('/api/settings/sender-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule ?? { sender, subject_contains: subject, label_id: label || null, archive }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('rules.failed'));
      if (!rule) { sender = ''; subject = ''; label = ''; }
      await load();
    } catch (cause) { error = cause instanceof Error ? cause.message : t('rules.failed'); }
    finally { busy = false; }
  }
  async function remove(id: string) {
    busy = true;
    try { const response = await fetch('/api/settings/sender-rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!response.ok) throw new Error(); await load(); }
    catch { error = t('rules.failed'); }
    finally { busy = false; }
  }
</script>
<section class="rules surface-lg">
  <h2>{t('rules.title')}</h2><p>{t('rules.hint')}</p>
  {#if error}<p role="alert">{error} {#if !loaded}<button type="button" onclick={load}>{t('cleanup.retry')}</button>{/if}</p>{/if}
  <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <label>{t('rules.sender')}<input type="email" bind:value={sender} required placeholder="billing@example.com" /></label>
    <label>{t('rules.subject')}<input bind:value={subject} maxlength="200" placeholder={t('rules.anySubject')} /></label>
    <label>{t('rules.label')}<select bind:value={label}><option value="">{t('rules.noLabel')}</option>{#each labels as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
    <label class="check"><input type="checkbox" bind:checked={archive} />{t('rules.archive')}</label>
    <button class="btn-primary" type="submit" disabled={busy || !loaded || (!archive && !label)}>{t('rules.add')}</button>
  </form>
  {#if loaded && !rules.length}<p>{t('rules.empty')}</p>{/if}
  {#each rules as rule (rule.id)}
    <article><strong>{rule.sender}</strong>{#if rule.subject_contains}<p>{t('rules.contains', { text: rule.subject_contains })}</p>{/if}<p>{rule.label_id ? labels.find((item) => item.id === rule.label_id)?.name ?? t('rules.noLabel') : ''}{rule.archive ? ` · ${t('nav.archive')}` : ''}</p>
      <div class="actions"><label class="check"><input type="checkbox" checked={Boolean(rule.enabled)} disabled={busy} onchange={(event) => save({ ...rule, enabled: event.currentTarget.checked ? 1 : 0 })} />{t('rules.enabled')}</label><button type="button" disabled={busy} onclick={() => remove(rule.id)}>{t('rules.remove')}</button></div>
    </article>
  {/each}
</section>
<style>
  .rules { padding: 1.25rem; border: 1px solid var(--color-line); border-radius: .75rem; margin: 1rem 0; }h2 { font-weight: 600; }p { color: var(--color-text-secondary); font-size: .8rem; margin: .5rem 0; }form { display: grid; gap: .75rem; max-width: 600px; margin: 1rem 0; }label { display: flex; flex-direction: column; gap: .35rem; font-size: .8rem; }.check { flex-direction: row; align-items: center; }input:not([type=checkbox]), select { border: 1px solid var(--color-line); border-radius: .4rem; padding: .6rem; background: var(--color-surface); color: var(--color-text); }article { padding: .8rem 0; border-top: 1px solid var(--color-line); }strong { font-size: .85rem; overflow-wrap: anywhere; }.actions { display: flex; gap: 1.5rem; align-items: center; font-size: .8rem; }.actions button { text-decoration: underline; }
</style>
