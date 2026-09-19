<script lang="ts">
  import { beforeNavigate, goto, replaceState } from '$app/navigation';
  import { page } from '$app/stores';
  import { onDestroy, untrack } from 'svelte';
  import { createDraftSaver, type DraftSaveState } from '$lib/mail/drafts';
  import { t } from '$lib/i18n';
  let { id, revision = 0, payload, hasContent, disabled = false }: { id: string; revision?: number; payload: Record<string, unknown>; hasContent: boolean; disabled?: boolean } = $props();
  let status = $state<DraftSaveState>(untrack(() => revision > 0 ? 'saved' : 'idle'));
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let initialized = false;
  let navigating = false;
  const saver = createDraftSaver({ id: untrack(() => id), revision: untrack(() => revision),
    onState: (state, message) => { status = state; error = message ?? ''; },
    onSaved: () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('draft') !== id) {
        url.searchParams.set('draft', id);
        replaceState(url, $page.state);
      }
    }
  });
  $effect(() => {
    const value = JSON.stringify(payload);
    const content = hasContent;
    const paused = disabled;
    untrack(() => {
      saver.update(value, !initialized && (revision > 0 || !content));
      initialized = true;
      clearTimeout(timer);
      if (!paused && !stopped && saver.dirty) timer = setTimeout(() => void saver.flush(), 700);
    });
  });
  export async function flush() { clearTimeout(timer); saver.update(JSON.stringify(payload)); return saver.flush(); }
  export function finish() { stopped = true; saver.stop(); clearTimeout(timer); }
  function protect(event: BeforeUnloadEvent) {
    if (!stopped && saver.dirty) { event.preventDefault(); event.returnValue = ''; }
  }
  beforeNavigate((navigation) => {
    if (stopped || !saver.dirty || navigating) return;
    navigation.cancel();
    if (navigation.type === 'leave') return;
    if (navigation.to) void flush().then(async (ok) => {
      if (ok) { navigating = true; await goto(navigation.to!.url, { replaceState: navigation.type === 'popstate' }); navigating = false; }
    });
  });
  onDestroy(() => { clearTimeout(timer); saver.stop(); });
</script>
<svelte:window onbeforeunload={protect} />
<div class="draft-status" role="status" aria-live="polite">
  {#if status === 'saving'}{t('draftSafety.saving')}
  {:else if status === 'saved'}{t('draftSafety.saved')}
  {:else if status === 'error'}<span>{error}</span> <button type="button" onclick={flush}>{t('draftSafety.retry')}</button>
  {:else if status === 'unsaved'}{t('draftSafety.unsaved')}{/if}
</div>
<style>.draft-status { padding: .5rem .9rem; font-size: .75rem; color: var(--color-text-secondary); } button { text-decoration: underline; margin-left: .5rem; }</style>
