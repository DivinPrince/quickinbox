<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import MailboxView from '$lib/components/MailboxView.svelte';
	import ClassicThread from '$lib/components/ClassicThread.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PaneResizer from '$themes/zero/PaneResizer.svelte';
	import { MAIL_CHANGED_MESSAGE } from '$lib/mail/sync';
	import { t } from '$lib/i18n';
	import { CLASSIC_LAYOUT, type ClassicLayoutContext } from './layout';
	import type { MailboxFilters, MailboxPage, MailboxView as MailView, ThreadViewData } from '$lib/types';

	let { view, mailbox, filters }: { view: MailView; mailbox: MailboxPage; filters: MailboxFilters } = $props();
	const preference = getContext<ClassicLayoutContext>(CLASSIC_LAYOUT);
	const layout = $derived(preference.value);
	let desktop = $state(false);
	const paneId = $props.id();
	const split = $derived(desktop && layout !== 'none' && view !== 'drafts');
	const messageId = $derived($page.url.searchParams.get('thread'));
	const accountId = $derived($page.data.user?.id);
	const domainId = $derived($page.data.activeDomainId);
	const listHref = $derived.by(() => {
		const url = new URL($page.url);
		url.searchParams.delete('thread');
		return `${url.pathname}${url.search}`;
	});
	let thread = $state<ThreadViewData | null>(null);
	let loading = $state(false);
	let error = $state('');
	let reload: (() => Promise<void>) | undefined;

	onMount(() => {
		const media = matchMedia('(min-width: 901px)');
		const update = () => { desktop = media.matches; };
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	function openMessage(id: string) {
		const url = new URL($page.url);
		url.searchParams.set('thread', id);
		void goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
	}

	async function closeMessage() {
		await goto(listHref, { noScroll: true, keepFocus: true });
	}

	async function refresh() {
		await reload?.();
		await invalidateAll();
	}

	$effect(() => {
		const id = messageId;
		// Changing accounts or domains must also discard the old reader immediately.
		const account = accountId;
		const domain = domainId;
		void domain;
		thread = null;
		error = '';
		loading = false;
		reload = undefined;
		if (!id || !account) return;
		const controller = new AbortController();
		let sequence = 0;
		const load = async (initial = false) => {
			const request = ++sequence;
			if (initial) loading = true;
			try {
				const response = await fetch(`/api/mail/${encodeURIComponent(id)}?view=classic`, { signal: controller.signal });
				if (!response.ok) throw new Error(t('thread.couldNotLoad'));
				const body = await response.json() as ThreadViewData;
				if (controller.signal.aborted || request !== sequence) return;
				thread = body;
				error = '';
				if (initial) await invalidateAll();
			} catch {
				if (initial && !controller.signal.aborted && request === sequence) error = t('thread.couldNotLoad');
			} finally {
				if (!controller.signal.aborted && request === sequence) loading = false;
			}
		};
		reload = () => load();
		void load(true);
		const changed = () => { void load(); };
		window.addEventListener(MAIL_CHANGED_MESSAGE, changed);
		return () => {
			controller.abort();
			window.removeEventListener(MAIL_CHANGED_MESSAGE, changed);
		};
	});
</script>

<div class="classic-mailbox" class:split class:reading={Boolean(messageId)} data-layout={layout}>
	<div id={paneId} class="classic-list">
		<MailboxView {view} {mailbox} {filters} onOpen={split ? openMessage : undefined} activeMessageId={messageId} />
	</div>
	{#if split}
		{#key layout}
			<PaneResizer {paneId} storageKey={`quickinbox:classic-list-${layout}`} label={t('panes.resizeMessageList')}
				orientation={layout === 'horizontal' ? 'horizontal' : 'vertical'} min={layout === 'horizontal' ? 10 : 20} max={60} remaining={layout === 'horizontal' ? 14 : 22} />
		{/key}
	{/if}
	{#if split || messageId}
		<section class="classic-reader" aria-label={thread?.subject ?? t('thread.chooseEmail')} aria-busy={loading}>
			{#if loading}
				<p class="reader-status" role="status">{t('common.loading')}</p>
			{:else if error}
				<div class="reader-status">
					<p role="alert">{error}</p>
					<button type="button" class="btn-ghost" onclick={closeMessage}>{t('panes.backToList')}</button>
				</div>
			{:else if thread}
				{#key messageId}
					<ClassicThread data={thread} onClose={closeMessage} onRefresh={refresh} returnHref={listHref} />
				{/key}
			{:else}
				<EmptyState icon="mail-open-line" title={t('thread.chooseEmail')} />
			{/if}
		</section>
	{/if}
</div>

<style>
	.classic-mailbox { min-width: 0; }
	.classic-list, .classic-reader { min-width: 0; }
	.classic-mailbox:not(.split).reading .classic-list { display: none; }
	.reader-status { padding: 2rem; color: var(--color-muted); text-align: center; }
	.split { display: flex; height: 100%; min-height: 0; }
	.split .classic-list { flex: 0 0 clamp(20rem, var(--z-pane-width, 42%), calc(100% - 22rem)); overflow: auto; background: var(--color-surface); }
	.split .classic-list :global(.mailbox) { border-radius: 0; box-shadow: none; }
	.split .classic-reader { flex: 1; min-height: 0; overflow: auto; padding: 0.75rem 0.75rem 1rem; background: var(--color-surface); }
	.split[data-layout='horizontal'] { flex-direction: column; }
	.split[data-layout='horizontal'] .classic-list { flex: 0 0 clamp(10rem, var(--z-pane-height, 40%), calc(100% - 14rem)); }
	.classic-mailbox :global(.z-pane-resizer) { position: relative; flex: 0 0 9px; align-self: stretch; display: flex; align-items: center; justify-content: center; cursor: col-resize; touch-action: none; user-select: none; }
	.classic-mailbox :global(.z-pane-resizer > span) { width: 3px; height: 28px; border-radius: 2px; background: var(--color-muted); opacity: 0.5; }
	.classic-mailbox :global(.z-pane-resizer:is(:hover, :focus-visible, .dragging)) { background: var(--color-accent-soft); outline: 2px solid var(--color-accent); outline-offset: -2px; border-radius: 4px; }
	.classic-mailbox :global(.z-pane-resizer[aria-orientation='horizontal']) { cursor: row-resize; }
	.classic-mailbox :global(.z-pane-resizer[aria-orientation='horizontal'] > span) { width: 28px; height: 3px; }
	.classic-mailbox :global(.z-resize-shield) { position: fixed; inset: 0; z-index: 1000; cursor: col-resize; }
	.classic-mailbox :global(.z-resize-shield.horizontal) { cursor: row-resize; }
</style>
