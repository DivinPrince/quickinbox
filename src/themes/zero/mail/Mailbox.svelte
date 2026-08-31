<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { formatRelativeDate } from '$lib/utils/date';
	import { runMailAction } from '$lib/mail/client';
	import { initials, participantName } from '$lib/mail/folders';
	import { t } from '$lib/i18n';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import type { MailboxFilters, MailboxPage, MailboxView, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import ThreadPane from './ThreadPane.svelte';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	let selected = $state<string[]>([]);
	let items = $state<ThreadSummary[]>([]);
	let refreshing = $state(false);
	let isMac = $state(true);
	let viewsOpen = $state(false);

	$effect(() => {
		items = mailbox.threads;
	});

	$effect(() => {
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	});

	const threadId = $derived($page.url.searchParams.get('thread'));
	const chip = $derived(
		filters.unreadOnly ? 'unread' : filters.starredOnly ? 'starred' : 'all'
	);
	let dark = $state(false);

	$effect(() => {
		dark = document.documentElement.dataset.theme === 'dark';
	});

	function setThread(id: string | null) {
		const url = new URL($page.url);
		if (id) url.searchParams.set('thread', id);
		else url.searchParams.delete('thread');
		void goto(`${url.pathname}?${url.searchParams.toString()}`.replace(/\?$/, ''), {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	function markThreadRead(threadId: string) {
		items = filters.unreadOnly
			? items.filter((thread) => thread.thread_id !== threadId)
			: items.map((thread) =>
					thread.thread_id === threadId ? { ...thread, is_read: true } : thread
				);
		void invalidateAll();
	}

	function setChip(next: 'all' | 'unread' | 'starred') {
		const url = new URL($page.url);
		url.searchParams.delete('unread');
		url.searchParams.delete('starred');
		if (next === 'unread') url.searchParams.set('unread', '1');
		if (next === 'starred') url.searchParams.set('starred', '1');
		viewsOpen = false;
		void goto(`${url.pathname}?${url.searchParams.toString()}`.replace(/\?$/, ''));
	}

	function openPalette() {
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'k',
				metaKey: isMac,
				ctrlKey: !isMac,
				bubbles: true
			})
		);
	}

	function toggleSidebar() {
		window.dispatchEvent(new Event('zero:toggle-sidebar'));
	}

	function openCompose() {
		window.dispatchEvent(new Event('zero:compose'));
	}

	function closeViews() {
		viewsOpen = false;
	}

	function onDocPointer(event: PointerEvent) {
		const target = event.target as HTMLElement | null;
		if (!target?.closest('.z-views')) closeViews();
	}

	const viewLabel = $derived(
		chip === 'unread' ? t('mailbox.unread') : chip === 'starred' ? t('nav.starred') : t('mailbox.views')
	);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			window.setTimeout(() => {
				refreshing = false;
			}, 280);
		}
	}

	async function act(action: string, ids: string[]) {
		await runMailAction(action, ids);
		await invalidateAll();
	}

	function onRowClick(thread: ThreadSummary, event: MouseEvent) {
		if (event.metaKey || event.ctrlKey || event.shiftKey) {
			selected = selected.includes(thread.thread_id)
				? selected.filter((id) => id !== thread.thread_id)
				: [...selected, thread.thread_id];
			return;
		}
		if (thread.is_draft) {
			const url = new URL($page.url);
			url.searchParams.set('compose', '1');
			url.searchParams.set('draft', thread.latest_id);
			void goto(`${url.pathname}?${url.searchParams.toString()}`);
			return;
		}
		setThread(thread.latest_id);
	}

	function onListKey(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}
		const current = threadId ? items.find((thread) => thread.latest_id === threadId) : null;
		const ids = selected.length
			? (selected
					.map((id) => items.find((thread) => thread.thread_id === id)?.latest_id)
					.filter(Boolean) as string[])
			: current
				? [current.latest_id]
				: [];
		if (ids.length === 0) return;

		if (event.key === 'e') {
			event.preventDefault();
			void act(view === 'archive' ? 'unarchive' : 'archive', ids);
		} else if (event.key === 'd' || event.key === 'Backspace') {
			event.preventDefault();
			void act(view === 'trash' ? 'restore' : 'trash', ids);
		} else if (event.key === 's') {
			event.preventDefault();
			void act(current?.is_starred ? 'unstar' : 'star', ids);
		} else if (event.key === 'r' && !threadId) {
			event.preventDefault();
			void act('read', ids);
		} else if (event.key === 'u') {
			event.preventDefault();
			void act('unread', ids);
		} else if (event.key === '1') {
			setChip('all');
		} else if (event.key === '2') {
			setChip('unread');
		} else if (event.key === '3') {
			setChip('starred');
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			selected = items.map((thread) => thread.thread_id);
		} else if (event.key === 'Escape') {
			selected = [];
			setThread(null);
		}
	}
</script>

<svelte:window onkeydown={onListKey} onpointerdown={onDocPointer} />

<div class="z-mail" class:reading={Boolean(threadId)}>
	<section class="z-panel z-list">
		<div class="z-list-head">
			<div class="z-list-tools">
				<Tooltip text={t('nav.toggleSidebar')}>
					<button type="button" class="z-icon-btn" aria-label={t('nav.toggleSidebar')} onclick={toggleSidebar}>
						<Icon name="PanelLeftOpen" size={16} />
					</button>
				</Tooltip>
				<Tooltip text={t('common.search')} shortcut={isMac ? '⌘K' : 'Ctrl+K'} grow>
					<button type="button" class="z-search" onclick={openPalette}>
						<Icon name="Search" size={16} />
						<span class="z-search-label">{t('common.search')}</span>
						<kbd>
							<span>{isMac ? '⌘' : 'Ctrl'}</span>
							<span>K</span>
						</kbd>
					</button>
				</Tooltip>
				<div class="z-views">
					<button
						type="button"
						class="z-views-btn"
						aria-expanded={viewsOpen}
						aria-haspopup="menu"
						onclick={() => (viewsOpen = !viewsOpen)}
					>
						<span>{viewLabel}</span>
						<Icon name="ChevronDown" size={12} />
					</button>
					{#if viewsOpen}
						<div class="z-views-menu" role="menu">
							<button type="button" role="menuitemcheckbox" aria-checked={chip === 'all'} onclick={() => setChip('all')}>
								{t('mailbox.allMail')}
								{#if chip === 'all'}<Icon name="Check" size={14} />{/if}
							</button>
							<button type="button" role="menuitemcheckbox" aria-checked={chip === 'unread'} onclick={() => setChip('unread')}>
								{t('mailbox.unread')}
								{#if chip === 'unread'}<Icon name="Check" size={14} />{/if}
							</button>
							<button type="button" role="menuitemcheckbox" aria-checked={chip === 'starred'} onclick={() => setChip('starred')}>
								{t('nav.starred')}
								{#if chip === 'starred'}<Icon name="Check" size={14} />{/if}
							</button>
						</div>
					{/if}
				</div>
				<Tooltip text={t('common.refresh')}>
					<button
						type="button"
						class="z-icon-btn"
						class:spin={refreshing}
						aria-label={t('common.refresh')}
						onclick={refresh}
					>
						<Icon name="ArrowCircle" size={16} />
					</button>
				</Tooltip>
			</div>
			<div class="z-load-bar" class:on={refreshing}></div>
		</div>

		<div class="z-chips">
			<button type="button" class="z-chip" class:active={chip === 'all'} data-chip="all" onclick={() => setChip('all')}>
				{t('mailbox.allMailChip')}
			</button>
			<button
				type="button"
				class="z-chip"
				class:active={chip === 'unread'}
				data-chip="unread"
				onclick={() => setChip('unread')}
			>
				{t('mailbox.unread')}
			</button>
			<button
				type="button"
				class="z-chip"
				class:active={chip === 'starred'}
				data-chip="starred"
				onclick={() => setChip('starred')}
			>
				{t('nav.starred')}
			</button>
		</div>

		<div class="z-rows">
			{#if items.length === 0}
				<div class="z-empty">
					<img
						src={dark ? '/themes/zero/empty-state.svg' : '/themes/zero/empty-state-light.svg'}
						alt=""
					/>
					<p class="z-empty-title">{t('mailbox.empty.zero')}</p>
					<p class="z-empty-copy">
						{t('mailbox.empty.zeroHint')}
						<button type="button" class="z-empty-link" onclick={() => setChip('all')}>{t('mailbox.empty.clearFiltersLink')}</button>
					</p>
				</div>
			{:else}
				{#each items as thread (thread.thread_id)}
					{@const name = participantName(thread.participants, view, $page.data.locale)}
					<div
						class="z-row"
						class:selected={thread.latest_id === threadId || selected.includes(thread.thread_id)}
						class:unread={!thread.is_read}
						class:read={thread.is_read}
						role="button"
						tabindex="0"
						onclick={(event) => onRowClick(thread, event)}
						onkeydown={(event) => {
							if (event.key === 'Enter') onRowClick(thread, event as unknown as MouseEvent);
						}}
					>
						<div class="z-row-hover">
							<Tooltip text={thread.is_starred ? t('mailbox.unstar') : t('mailbox.star')}>
								<button
									type="button"
									aria-label={thread.is_starred ? t('mailbox.unstar') : t('mailbox.star')}
									onclick={(event) => {
										event.stopPropagation();
										void act(thread.is_starred ? 'unstar' : 'star', [thread.latest_id]);
									}}
								>
									<Icon name="Star2" class={thread.is_starred ? 'z-star-on' : ''} size={14} />
								</button>
							</Tooltip>
							<Tooltip text={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}>
								<button
									type="button"
									aria-label={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}
									onclick={(event) => {
										event.stopPropagation();
										void act(view === 'archive' ? 'unarchive' : 'archive', [thread.latest_id]);
									}}
								>
									<Icon name="Archive2" size={14} />
								</button>
							</Tooltip>
							<Tooltip text={view === 'trash' ? t('mailbox.restore') : t('nav.bin')}>
								<button
									type="button"
									class="danger"
									aria-label={view === 'trash' ? t('mailbox.restore') : t('nav.bin')}
									onclick={(event) => {
										event.stopPropagation();
										void act(view === 'trash' ? 'restore' : 'trash', [thread.latest_id]);
									}}
								>
									<Icon name="Trash" size={14} />
								</button>
							</Tooltip>
						</div>
						<span class="z-avatar">{initials(name)}</span>
						<span class="z-row-main">
							<span class="z-row-top">
								<span class="z-row-name">
									{name}
									{#if !thread.is_read && view !== 'sent'}
										<span class="z-unread-dot"></span>
									{/if}
									{#if thread.message_count > 1}
										<span class="z-row-count">[{thread.message_count}]</span>
									{/if}
									{#if thread.is_draft}
										<Icon name="PencilCompose" size={12} />
									{/if}
								</span>
								<span class="z-row-date">{formatRelativeDate(thread.created_at, $page.data.locale)}</span>
							</span>
							<span class="z-row-subject">
								{thread.subject || t('mailbox.noSubject')}
								{#if thread.has_attachments}
									<Icon name="Paper" size={12} />
								{/if}
							</span>
							{#if thread.preview}
								<span class="z-row-preview">{thread.preview}</span>
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</section>

	<section class="z-panel z-read">
		<ThreadPane
			id={threadId}
			view={view}
			onClose={() => setThread(null)}
			onCompose={openCompose}
			onRead={markThreadRead}
		/>
	</section>
</div>
