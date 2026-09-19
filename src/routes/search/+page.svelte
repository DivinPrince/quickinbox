<script lang="ts">
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import SearchHighlight from '$lib/components/SearchHighlight.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  function pageHref(number: number) { const params = new URLSearchParams($page.url.searchParams); params.set('page', String(number)); return `/search?${params}`; }
</script>
<svelte:head><title>{t('searchFlow.title')} — Quickinbox</title></svelte:head>
<div class="search-page">
  <h1>{t('searchFlow.title')}</h1>
  <form action="/search" method="GET" class="surface-lg">
    <label class="query">{t('searchFlow.words')}<input type="search" name="q" value={data.filters.q} placeholder={t('searchFlow.placeholder')} /></label>
    <div class="filters">
      <label>{t('searchFlow.from')}<input name="from" value={data.filters.from} placeholder="alice@example.com" /></label>
      <label>{t('searchFlow.to')}<input name="to" value={data.filters.to} placeholder="you@example.com" /></label>
      <label>{t('searchFlow.after')}<input type="date" name="after" value={data.filters.after} /></label>
      <label>{t('searchFlow.before')}<input type="date" name="before" value={data.filters.before} /></label>
    </div>
    <div class="options"><label><input type="checkbox" name="attachments" value="1" checked={data.filters.attachments} />{t('searchFlow.attachments')}</label><label><input type="checkbox" name="hidden" value="1" checked={data.filters.includeHidden} />{t('searchFlow.hidden')}</label></div>
    <button class="btn-primary" type="submit">{t('common.search')}</button> <a class="reset" href="/search">{t('searchFlow.clear')}</a>
  </form>
  <p class="summary" role="status">{t('searchFlow.count', { count: data.total })}</p>
  {#if !data.results.length}<p>{t('searchFlow.empty')}</p>{/if}
  <div class="results">
    {#each data.results as result (result.id)}
      <a class="result surface-lg" href={result.status === 'draft' ? `/compose?draft=${result.id}` : `/mail/${result.id}`}>
        <div class="result-head"><strong><SearchHighlight text={result.subject || t('mailbox.noSubject')} query={data.filters.q} /></strong><time>{result.created_at.slice(0, 10)}</time></div>
        <p class="people"><SearchHighlight text={result.from_addr} query={data.filters.from || data.filters.q} /> → <SearchHighlight text={result.to_addr} query={data.filters.to || data.filters.q} /></p>
        <p><SearchHighlight text={result.excerpt} query={data.filters.q} /></p>
        {#if result.has_attachments}<small>{t('searchFlow.hasAttachments')}</small>{/if}
      </a>
    {/each}
  </div>
  {#if data.pages > 1}<nav aria-label={t('searchFlow.pages')}>{#if data.page > 1}<a href={pageHref(data.page - 1)}>{t('maintenance.previous')}</a>{/if}<span>{data.page} / {data.pages}</span>{#if data.page < data.pages}<a href={pageHref(data.page + 1)}>{t('maintenance.next')}</a>{/if}</nav>{/if}
</div>
<style>
  .search-page { max-width: 1000px; padding: clamp(1rem, 3vw, 2rem); margin: auto; width: 100%; }
  h1 { font-size: 1.5rem; font-weight: 650; margin-bottom: 1rem; }
  form { padding: 1.25rem; border: 1px solid var(--color-line); border-radius: .75rem; }
  label { display: flex; flex-direction: column; gap: .35rem; font-size: .8rem; }
  input:not([type=checkbox]) { border: 1px solid var(--color-line); border-radius: .4rem; padding: .6rem; min-width: 0; background: var(--color-surface); color: var(--color-text); }
  .filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin-top: .75rem; }
  .options { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }.options label { flex-direction: row; align-items: center; }
  .summary, p { color: var(--color-text-secondary); font-size: .85rem; margin: .7rem 0; overflow-wrap: anywhere; }
  .result { display: block; padding: 1rem; border: 1px solid var(--color-line); border-radius: .6rem; margin-bottom: .6rem; }
  .result:hover { border-color: var(--color-text-secondary); }.result-head { display: flex; justify-content: space-between; gap: 1rem; }.result-head strong { overflow-wrap: anywhere; }
  time, small { font-size: .7rem; color: var(--color-text-secondary); }time { flex-shrink: 0; }.people { font-size: .75rem; }
  .reset, nav a { text-decoration: underline; }nav { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1rem; font-size: .8rem; }
  @media(max-width: 480px) { .filters { grid-template-columns: 1fr; } }
</style>
