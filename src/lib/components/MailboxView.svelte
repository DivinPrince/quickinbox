<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import EmptyState from './EmptyState.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import SwipeRow from './SwipeRow.svelte';
	import PullToRefresh from './PullToRefresh.svelte';
	import { formatRelativeDate } from '$lib/utils/date';
	import { haptic, isPrimaryTab } from '$lib/app-chrome';
	import { plural, t } from '$lib/i18n';
	import type {
		MailAddress,
		MailboxFilters,
		MailboxPage,
		MailboxView,
		ThreadSummary
	} from '$lib/types';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	const META = $derived<Record<MailboxView, { title: string; icon: string; empty: string }>>({
		inbox: { title: t('nav.inbox'), icon: 'inbox-line', empty: t('mailbox.empty.inbox') },
		archive: { title: t('nav.archive'), icon: 'archive-line', empty: t('mailbox.empty.archive') },
		starred: { title: t('nav.starred'), icon: 'star-line', empty: t('mailbox.empty.starred') },
		drafts: { title: t('nav.drafts'), icon: 'draft-line', empty: t('mailbox.empty.drafts') },
		sent: { title: t('nav.sent'), icon: 'send-plane-line', empty: t('mailbox.empty.sent') },
		trash: { title: t('nav.trash'), icon: 'delete-bin-line', empty: t('mailbox.empty.trash') }
	});

	const meta = $derived(META[view]);
	const addresses = $derived(($currentPage.data.addresses ?? []) as MailAddress[]);

	/** The identity a conversation arrived on — shown only when it disambiguates. */
	function identity(thread: ThreadSummary): MailAddress | null {
		if (addresses.length < 2) return null;
		// Catch-all deliveries have no address_id on purpose; do not guess from domain.
		return addresses.find((address) => address.id === thread.address_id) ?? null;
	}

	// Local copy so stars and reads can flip before the server round trip lands.
	let items = $state<ThreadSummary[]>([]);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let actionError = $state('');
	let filterOpen = $state(false);
	let moreOpen = $state(false);
	let selectMenuOpen = $state(false);
	let selecting = $state(false);
	let hadSelection = $state(false);
	let longPressTimer = 0;
	let longPressFired = false;
	let pressX = 0;
	let pressY = 0;

	$effect(() => {
		items = mailbox.threads;
		selected = [];
		selecting = false;
		hadSelection = false;
	});

	$effect(() => {
		if (selected.length > 0) hadSelection = true;
		if (hadSelection && selected.length === 0) {
			selecting = false;
			hadSelection = false;
		}
	});

	const hideMailboxTitle = $derived(isPrimaryTab(`/${view}`));

	const allSelected = $derived(items.length > 0 && selected.length === items.length);
	const someSelected = $derived(selected.length > 0);
	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly, filters.addressId].filter(
			Boolean
		).length
	);

	/**
	 * Who to show on the row. Sent and Drafts are about where a message went, so
	 * they name the recipient; everywhere else names the people in the thread.
	 */
	function people(thread: ThreadSummary): string {
		if (view === 'drafts' || view === 'sent') {
			return recipientOf(thread) || (view === 'drafts' ? t('mailbox.noRecipient') : t('common.unknown'));
		}

		return thread.participants
			.filter((participant) => !participant.self)
			.map((participant) => participant.label || participant.address)
			.join(', ');
	}

	function recipientOf(thread: ThreadSummary): string {
		return thread.participants
			.filter((participant) => !participant.self)
			.map((participant) => participant.label || participant.address)
			.join(', ');
	}

	function initial(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		const participant = external ?? thread.participants[0];
		return (participant?.label || participant?.address || '?')[0].toUpperCase();
	}

	/** Rows carry the newest message; opening it opens the whole conversation. */
	function href(thread: ThreadSummary): string {
		return thread.is_draft ? `/compose?draft=${thread.latest_id}` : `/mail/${thread.latest_id}`;
	}

	function toggle(id: string) {
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}

	function selectAll(next: boolean) {
		selected = next ? items.map((thread) => thread.latest_id) : [];
	}

	function selectWhere(predicate: (thread: ThreadSummary) => boolean) {
		selected = items.filter(predicate).map((thread) => thread.latest_id);
		selectMenuOpen = false;
	}

	/** One entry point for every list action, so the UI always refreshes after. */
	async function run(action: string, ids: string[] = selected) {
		if (busy) return;
		actionError = '';
		busy = true;
		try {
			const response = await fetch('/api/mail/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids })
			});
			if (!response.ok) {
				actionError = t('mailbox.updateFailed');
				return;
			}
			selected = [];
			await invalidateAll();
		} catch {
			actionError = t('mailbox.updateNetwork');
		} finally {
			busy = false;
			moreOpen = false;
		}
	}

	function beginLongPress(thread: ThreadSummary, event: PointerEvent) {
		longPressFired = false;
		pressX = event.clientX;
		pressY = event.clientY;
		window.clearTimeout(longPressTimer);
		longPressTimer = window.setTimeout(() => {
			longPressFired = true;
			selecting = true;
			if (!selected.includes(thread.latest_id)) toggle(thread.latest_id);
			haptic(16);
		}, 420);
	}

	function cancelLongPress() {
		window.clearTimeout(longPressTimer);
	}

	function moveLongPress(event: PointerEvent) {
		if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 8) cancelLongPress();
	}

	function swipeLeftAction(thread: ThreadSummary) {
		if (view === 'trash') return { icon: 'delete-bin-2-line', label: t('mailbox.delete'), tone: 'danger' as const };
		return { icon: 'delete-bin-line', label: t('nav.trash'), tone: 'danger' as const };
	}

	function swipeRightAction(thread: ThreadSummary) {
		if (view === 'trash') return { icon: 'arrow-go-back-line', label: t('mailbox.restore'), tone: 'good' as const };
		return {
			icon: thread.is_starred ? 'star-fill' : 'star-line',
			label: thread.is_starred ? t('mailbox.unstar') : t('mailbox.star'),
			tone: 'star' as const
		};
	}

	function onSwipeLeft(thread: ThreadSummary) {
		if (view === 'trash') void run('delete', [thread.latest_id]);
		else void run('trash', [thread.latest_id]);
	}

	function onSwipeRight(thread: ThreadSummary) {
		if (view === 'trash') void run('restore', [thread.latest_id]);
		else void toggleStar(thread);
	}

	async function toggleStar(thread: ThreadSummary) {
		const isStarred = !thread.is_starred;
		items = items.map((row) =>
			row.thread_id === thread.thread_id ? { ...row, is_starred: isStarred } : row
		);

		await fetch(`/api/mail/${thread.latest_id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isStarred })
		});
		await invalidateAll();
	}

	/** Builds a URL for this mailbox with some query params changed. */
	function withParams(changes: Record<string, string | number | boolean | null>): string {
		const params = new URLSearchParams($currentPage.url.searchParams);

		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === false || value === '') params.delete(key);
			else params.set(key, String(value));
		}

		// Changing what is listed invalidates the current page number.
		if (!('page' in changes)) params.delete('page');

		const query = params.toString();
		return `${$currentPage.url.pathname}${query ? `?${query}` : ''}`;
	}

	function apply(changes: Record<string, string | number | boolean | null>) {
		filterOpen = false;
		goto(withParams(changes));
	}

	const rangeStart = $derived(
		mailbox.total === 0 ? 0 : (mailbox.page - 1) * mailbox.pageSize + 1
	);
	const rangeEnd = $derived(Math.min(mailbox.page * mailbox.pageSize, mailbox.total));
</script>

<PullToRefresh onRefresh={invalidateAll}>
<section class="mailbox" data-view={view} class:selecting class:primary-tab={hideMailboxTitle}>
	<header class="toolbar">
		<div class="toolbar-left">
			<div class="select-all">
				<Check
					label={t('mailbox.selectAll')}
					checked={allSelected}
					indeterminate={someSelected && !allSelected}
					onchange={selectAll}
				/>
				<button
					type="button"
					class="caret"
					aria-label={t('mailbox.selectionOptions')}
					aria-expanded={selectMenuOpen}
					onclick={() => (selectMenuOpen = !selectMenuOpen)}
				>
					<Icon name="arrow-down-s-line" size={14} />
				</button>

				{#if selectMenuOpen}
					<button
						type="button"
						class="backdrop"
						aria-label={t('mailbox.closeMenu')}
						onclick={() => (selectMenuOpen = false)}
					></button>
					<div class="menu menu-left" role="menu">
						<button type="button" class="menu-item" onclick={() => selectWhere(() => true)}>
							{t('common.all')}
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere(() => false)}>
							{t('common.none')}
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => !e.is_read)}>
							{t('mailbox.unread')}
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_read)}>
							{t('mailbox.read')}
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_starred)}>
							{t('nav.starred')}
						</button>
					</div>
				{/if}
			</div>

			{#if someSelected}
				<span class="selected-count">{t('mailbox.selectedCount', { count: selected.length })}</span>

				<div class="bulk-actions">
					<button
						type="button"
						class="tool-btn"
						title={t('mailbox.markRead')}
						disabled={busy}
						onclick={() => run('read')}
					>
						<Icon name="mail-open-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title={t('mailbox.markUnread')}
						disabled={busy}
						onclick={() => run('unread')}
					>
						<Icon name="mail-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title={t('mailbox.star')}
						disabled={busy}
						onclick={() => run('star')}
					>
						<Icon name="star-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title={t('mailbox.removeStar')}
						disabled={busy}
						onclick={() => run('unstar')}
					>
						<Icon name="star-off-line" size={16} />
					</button>
					{#if view === 'archive'}
						<button
							type="button"
							class="tool-btn"
							title={t('mailbox.moveToInbox')}
							disabled={busy}
							onclick={() => run('unarchive')}
						>
							<Icon name="inbox-line" size={16} />
						</button>
					{:else if view !== 'drafts' && view !== 'trash'}
						<button
							type="button"
							class="tool-btn"
							title={t('nav.archive')}
							disabled={busy}
							onclick={() => run('archive')}
						>
							<Icon name="archive-line" size={16} />
						</button>
					{/if}

					{#if view === 'trash'}
						<button
							type="button"
							class="tool-btn"
							title={t('mailbox.restore')}
							disabled={busy}
							onclick={() => run('restore')}
						>
							<Icon name="arrow-go-back-line" size={16} />
						</button>
						<button
							type="button"
							class="tool-btn danger"
							title={t('mailbox.deletePermanently')}
							disabled={busy}
							onclick={() => run('delete')}
						>
							<Icon name="delete-bin-2-line" size={16} />
						</button>
					{:else}
						<button
							type="button"
							class="tool-btn"
							title={t('mailbox.moveToTrash')}
							disabled={busy}
							onclick={() => run('trash')}
						>
							<Icon name="delete-bin-line" size={16} />
						</button>
					{/if}
				</div>
			{:else}
				<h1 class="title">{meta.title}</h1>
				{#if mailbox.total > 0}
					<span class="total">{mailbox.total}</span>
				{/if}

				<div class="more">
					<button
						type="button"
						class="tool-btn"
						aria-label={t('mailbox.mailboxActions')}
						aria-expanded={moreOpen}
						onclick={() => (moreOpen = !moreOpen)}
					>
						<Icon name="more-line" size={16} />
					</button>

					{#if moreOpen}
						<button
							type="button"
							class="backdrop"
							aria-label={t('mailbox.closeMenu')}
							onclick={() => (moreOpen = false)}
						></button>
						<div class="menu menu-left" role="menu">
							{#if selecting}
								<button
									type="button"
									class="menu-item"
									onclick={() => {
										selected = [];
										selecting = false;
										hadSelection = false;
										moreOpen = false;
									}}
								>
									<Icon name="close-line" size={15} /> {t('mailbox.cancelSelection')}
								</button>
							{:else}
								<button
									type="button"
									class="menu-item"
									onclick={() => {
										selecting = true;
										moreOpen = false;
									}}
								>
									<Icon name="checkbox-multiple-line" size={15} /> {t('common.select')}
								</button>
							{/if}
							{#if addresses.length > 1}
								{#each addresses as address (address.id)}
									<button
										type="button"
										class="menu-item"
										onclick={() =>
											apply({ address: filters.addressId === address.id ? null : address.id })}
									>
										<Icon
											name={filters.addressId === address.id
												? 'radio-button-line'
												: 'checkbox-blank-circle-line'}
											size={15}
										/>
										{address.label || address.address}
									</button>
								{/each}
							{/if}
							<button
								type="button"
								class="menu-item"
								onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
							>
								<Icon
									name={filters.unreadOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
									size={15}
								/>
								{t('mailbox.unreadOnly')}
							</button>
							<button
								type="button"
								class="menu-item"
								onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}
							>
								<Icon
									name={filters.starredOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
									size={15}
								/>
								{t('mailbox.starredOnly')}
							</button>
							<button
								type="button"
								class="menu-item"
								onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}
							>
								<Icon
									name={filters.attachmentsOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
									size={15}
								/>
								{t('mailbox.hasAttachments')}
							</button>
							{#if activeFilterCount > 0 || filters.q}
								<button
									type="button"
									class="menu-item"
									onclick={() =>
										apply({
											unread: null,
											starred: null,
											attachments: null,
											address: null,
											q: null
										})}
								>
									<Icon name="close-circle-line" size={15} /> {t('mailbox.clearFilters')}
								</button>
							{/if}
							<button type="button" class="menu-item" onclick={() => run('read-all', [])}>
								<Icon name="mail-open-line" size={15} /> {t('mailbox.markAllRead')}
							</button>
							<button type="button" class="menu-item" onclick={() => invalidateAll()}>
								<Icon name="refresh-line" size={15} /> {t('common.refresh')}
							</button>
							{#if view === 'trash'}
								<button
									type="button"
									class="menu-item danger"
									onclick={() => run('empty-trash', [])}
								>
									<Icon name="delete-bin-2-line" size={15} /> {t('mailbox.emptyTrash')}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="toolbar-right">
			<button
				type="button"
				class="pill unread-pill"
				class:pill-on={filters.unreadOnly}
				onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
			>
				{t('mailbox.unread')}
			</button>

			<div class="filter">
				<button
					type="button"
					class="pill"
					class:pill-on={activeFilterCount > 0}
					aria-label={t('common.filter')}
					aria-expanded={filterOpen}
					onclick={() => (filterOpen = !filterOpen)}
				>
					<Icon name="equalizer-line" size={14} />
					<span class="filter-label">{t('common.filter')}</span>
					{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
				</button>

				{#if filterOpen}
					<button
						type="button"
						class="backdrop"
						aria-label={t('common.close')}
						onclick={() => (filterOpen = false)}
					></button>
					<div class="menu menu-right" role="menu">
						{#if addresses.length > 1}
							{#each addresses as address (address.id)}
								<button
									type="button"
									class="menu-item"
									onclick={() =>
										apply({ address: filters.addressId === address.id ? null : address.id })}
								>
									<Icon
										name={filters.addressId === address.id
											? 'radio-button-line'
											: 'checkbox-blank-circle-line'}
										size={15}
									/>
									{address.label || address.address}
								</button>
							{/each}
						{/if}
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
						>
							<Icon
								name={filters.unreadOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							{t('mailbox.unreadOnly')}
						</button>
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}
						>
							<Icon
								name={filters.starredOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							{t('mailbox.starredOnly')}
						</button>
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}
						>
							<Icon
								name={filters.attachmentsOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							{t('mailbox.hasAttachments')}
						</button>
						{#if activeFilterCount > 0 || filters.q}
							<button
								type="button"
								class="menu-item"
								onclick={() =>
									apply({ unread: null, starred: null, attachments: null, address: null, q: null })}
							>
								<Icon name="close-circle-line" size={15} /> {t('mailbox.clearAll')}
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="pager" class:pager-single={mailbox.pageCount <= 1}>
				<a
					class="pager-btn"
					class:disabled={mailbox.page <= 1}
					href={withParams({ page: mailbox.page - 1 })}
					aria-label={t('mailbox.previousPage')}
				>
					<Icon name="arrow-left-s-line" size={16} />
				</a>
				<span class="pager-label">{mailbox.page}/{mailbox.pageCount}</span>
				<a
					class="pager-btn"
					class:disabled={mailbox.page >= mailbox.pageCount}
					href={withParams({ page: mailbox.page + 1 })}
					aria-label={t('mailbox.nextPage')}
				>
					<Icon name="arrow-right-s-line" size={16} />
				</a>
			</div>
		</div>
	</header>

	{#if actionError}
		<p class="action-error" role="alert">{actionError}</p>
	{/if}

	{#if activeFilterCount > 0}
		<div class="filter-chips" aria-label={t('mailbox.activeFilters')}>
			{#if filters.unreadOnly}
				<a href={withParams({ unread: null })} class="filter-chip">{t('mailbox.unread')}</a>
			{/if}
			{#if filters.starredOnly}
				<a href={withParams({ starred: null })} class="filter-chip">{t('nav.starred')}</a>
			{/if}
			{#if filters.attachmentsOnly}
				<a href={withParams({ attachments: null })} class="filter-chip">{t('mailbox.attachments')}</a>
			{/if}
			{#if filters.addressId}
				{@const filtered = addresses.find((address) => address.id === filters.addressId)}
				<a href={withParams({ address: null })} class="filter-chip">
					{filtered?.label || filtered?.address || t('mailbox.address')}
				</a>
			{/if}
		</div>
	{/if}

	{#if filters.q}
		<div class="search-note">
			<Icon name="search-line" size={14} />
			<span>{plural($currentPage.data.locale, 'mailbox.searchResults', 'mailbox.searchResultsPlural', mailbox.total, { query: filters.q })}</span>
			<a href={withParams({ q: null })} class="search-clear">{t('mailbox.clear')}</a>
		</div>
	{/if}

	<div class="list">
		{#if items.length === 0}
			<EmptyState
				icon={filters.q ? 'search-line' : meta.icon}
				title={filters.q ? t('mailbox.empty.search') : meta.empty}
			/>
		{:else}
			<ul>
				{#each items as thread (thread.thread_id)}
					<li
						class="row"
						class:unread={!thread.is_read}
						class:checked={selected.includes(thread.latest_id)}
					>
						<SwipeRow
							disabled={selecting}
							left={swipeRightAction(thread)}
							right={swipeLeftAction(thread)}
							onLeft={() => onSwipeRight(thread)}
							onRight={() => onSwipeLeft(thread)}
						>
						<Check
							label={t('mailbox.selectConversation', { people: people(thread) })}
							checked={selected.includes(thread.latest_id)}
							onchange={() => toggle(thread.latest_id)}
						/>

						<button
							type="button"
							class="star"
							class:on={thread.is_starred}
							aria-label={thread.is_starred ? t('mailbox.removeStar') : t('mailbox.addStar')}
							onclick={() => toggleStar(thread)}
						>
							<Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={15} />
						</button>

						<a
							class="row-link"
							href={href(thread)}
							onclick={(event) => {
								if (longPressFired || selecting) {
									event.preventDefault();
									if (selecting) toggle(thread.latest_id);
								}
							}}
							onpointerdown={(event) => beginLongPress(thread, event)}
							onpointerup={cancelLongPress}
							onpointercancel={cancelLongPress}
							onpointermove={moveLongPress}
						>
							<span class="avatar">{initial(thread)}</span>

							<span class="sender" title={people(thread)}>
								<span class="sender-names">{people(thread)}</span>
								{#if thread.message_count > 1}
									<span class="count">{thread.message_count}</span>
								{/if}
								{#if thread.is_draft}<span class="tag tag-draft">{t('mailbox.draftTag')}</span>{/if}
								{#if identity(thread)}
									<span class="tag">{identity(thread)?.label || identity(thread)?.address}</span>
								{/if}
							</span>

							<span class="body">
								<span class="subject">{thread.subject || t('mailbox.noSubject')}</span>
								{#if thread.preview}
									<span class="preview">— {thread.preview}</span>
								{/if}
							</span>

							<span class="indicators">
								{#if view === 'sent' && thread.status}
									<DeliveryStatus status={thread.status} />
								{/if}
								{#if thread.has_attachments}
									<Icon name="attachment-2" size={14} />
								{/if}
							</span>

							<span class="date">{formatRelativeDate(thread.created_at, $currentPage.data.locale)}</span>
						</a>

						<span class="row-actions">
							{#if view === 'trash'}
								<button
									type="button"
									class="tool-btn"
									title={t('mailbox.restore')}
									onclick={() => run('restore', [thread.latest_id])}
								>
									<Icon name="arrow-go-back-line" size={15} />
								</button>
								<button
									type="button"
									class="tool-btn danger"
									title={t('mailbox.deletePermanently')}
									onclick={() => run('delete', [thread.latest_id])}
								>
									<Icon name="delete-bin-2-line" size={15} />
								</button>
							{:else}
								<button
									type="button"
									class="tool-btn"
									title={thread.is_read ? t('mailbox.markUnread') : t('mailbox.markRead')}
									onclick={() => run(thread.is_read ? 'unread' : 'read', [thread.latest_id])}
								>
									<Icon name={thread.is_read ? 'mail-line' : 'mail-open-line'} size={15} />
								</button>
								{#if view === 'archive'}
									<button
										type="button"
										class="tool-btn"
										title={t('mailbox.moveToInbox')}
										onclick={() => run('unarchive', [thread.latest_id])}
									>
										<Icon name="inbox-line" size={15} />
									</button>
								{:else if view !== 'drafts'}
									<button
										type="button"
										class="tool-btn"
										title={t('nav.archive')}
										onclick={() => run('archive', [thread.latest_id])}
									>
										<Icon name="archive-line" size={15} />
									</button>
								{/if}
								<button
									type="button"
									class="tool-btn"
									title={t('mailbox.moveToTrash')}
									onclick={() => run('trash', [thread.latest_id])}
								>
									<Icon name="delete-bin-line" size={15} />
								</button>
							{/if}
						</span>
						</SwipeRow>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if mailbox.total > 0}
		<footer class="list-foot">
			<span>{rangeStart}–{rangeEnd} of {mailbox.total}</span>
		</footer>
	{/if}
</section>
</PullToRefresh>

<style>
	.mailbox {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.filter-chips {
		display: none;
	}

	/* --- toolbar --- */

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.toolbar-left,
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.title {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.total {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.selected-count {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.action-error {
		margin: 0.75rem 0.875rem 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		margin-left: 0.25rem;
	}

	.select-all {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding-right: 0.25rem;
	}

	.caret {
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}

	.caret:hover {
		color: var(--color-text);
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.tool-btn:disabled {
		opacity: 0.4;
	}

	.tool-btn.danger:hover {
		color: var(--color-danger);
	}

	.more,
	.filter {
		position: relative;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.875rem;
		padding: 0 0.6875rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s, color 0.15s, box-shadow 0.15s;
	}

	.pill:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.pill-on {
		color: var(--color-text);
		font-weight: 500;
		background: var(--color-surface-hover);
		box-shadow: inset 0 0 0 1px transparent;
	}

	.filter-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.25rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.pager-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: background 0.15s;
	}

	.pager-btn:hover {
		background: var(--color-surface-muted);
	}

	.pager-btn.disabled {
		pointer-events: none;
		color: var(--color-muted);
		opacity: 0.4;
	}

	.pager-label {
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	/* --- dropdown menus --- */

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		z-index: 30;
		min-width: 11rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 0.75rem;
		box-shadow: var(--shadow-md);
	}

	.menu-left {
		left: 0;
	}

	.menu-right {
		right: 0;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
		transition: background 0.12s, color 0.12s;
	}

	.menu-item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.menu-item.danger:hover {
		color: var(--color-danger);
	}

	/* --- search note --- */

	.search-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.search-clear {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-muted);
		text-decoration: underline;
	}

	.search-clear:hover {
		color: var(--color-text);
	}

	/* --- rows --- */

	/* Read rows sit back a shade; unread ones stay bright and bold. */
	.row {
		position: relative;
		background: var(--color-bg);
		box-shadow: inset 0 -1px 0 var(--color-line);
		transition: background 0.12s;
	}

	.row:last-child {
		box-shadow: none;
	}

	.row :global(.swipe-content) {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.875rem;
		background: var(--color-bg);
	}

	.row.unread :global(.swipe-content) {
		background: var(--color-surface);
	}

	.row:hover :global(.swipe-content),
	.row.unread:hover :global(.swipe-content) {
		background: var(--color-surface-muted);
	}

	.row.checked :global(.swipe-content),
	.row.checked:hover :global(.swipe-content) {
		background: var(--color-accent-soft);
	}

	.star {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-muted);
		transition: color 0.12s;
	}

	.star:hover {
		color: var(--color-text);
	}

	.star.on {
		color: var(--color-star);
	}

	.row-link {
		display: grid;
		grid-template-columns: 2rem minmax(6rem, 11rem) minmax(0, 1fr) auto 4.5rem;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.625rem 0;
	}

	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.row.unread .avatar {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.sender {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.unread .sender {
		font-weight: 600;
		color: var(--color-text);
	}

	.sender-names {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* How many messages the conversation holds. */
	.count {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted);
	}

	.row.unread .count {
		color: var(--color-text-secondary);
	}

	.body {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}

	.subject {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row.unread .subject {
		font-weight: 600;
		color: var(--color-text);
	}

	.preview {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.indicators {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
		color: var(--color-muted);
	}

	.tag {
		padding: 0.125rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-surface-hover);
		white-space: nowrap;
	}

	.tag-draft {
		color: var(--color-danger);
		background: rgba(185, 28, 28, 0.08);
	}

	.date {
		font-size: 0.75rem;
		color: var(--color-muted);
		text-align: right;
		white-space: nowrap;
	}

	.row.unread .date {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.row-actions {
		position: absolute;
		top: 50%;
		right: 0.875rem;
		z-index: 5;
		display: none;
		align-items: center;
		gap: 0.125rem;
		padding-left: 1.5rem;
		transform: translateY(-50%);
		background: linear-gradient(to right, transparent, var(--color-surface-muted) 1.5rem);
	}

	.row:hover .row-actions {
		display: flex;
	}

	.list-foot {
		display: flex;
		justify-content: flex-end;
		padding: 0.625rem 0.875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	@media (max-width: 900px) {
		.mailbox {
			flex: 1;
			border-radius: 0;
			box-shadow: none;
			min-height: 100%;
			background: var(--color-bg);
		}

		.toolbar {
			position: sticky;
			top: 0;
			z-index: 8;
			flex-wrap: wrap;
			padding: 0.5rem 0.75rem;
			background: var(--color-surface);
		}

		.mailbox:not(.selecting) .toolbar-right {
			display: none;
		}

		.mailbox.primary-tab:not(.selecting) .toolbar {
			justify-content: flex-end;
			padding: 0.25rem 0.5rem;
			background: var(--color-bg);
			box-shadow: none;
		}

		.mailbox.primary-tab:not(.selecting) .toolbar-left {
			margin-left: auto;
		}

		.mailbox.primary-tab:not(.selecting) .title,
		.mailbox.primary-tab:not(.selecting) .total {
			display: none;
		}

		.filter-chips {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
		}

		.filter-chip {
			display: inline-flex;
			align-items: center;
			min-height: 2rem;
			padding: 0 0.75rem;
			border-radius: 9999px;
			font-size: 0.8125rem;
			font-weight: 500;
			color: var(--color-accent-text);
			background: var(--color-accent-soft);
		}

		.backdrop {
			background: var(--color-scrim);
			animation: sheet-fade 180ms ease-out;
		}

		.menu {
			position: fixed;
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			min-width: 0;
			padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
			border-radius: 1.25rem 1.25rem 0 0;
			animation: sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1);
		}

		.menu-left,
		.menu-right {
			left: 0;
			right: 0;
		}

		@keyframes sheet-up {
			from {
				transform: translateY(16%);
			}
		}

		@keyframes sheet-fade {
			from {
				opacity: 0;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.menu,
			.backdrop {
				animation: none;
			}
		}

		.unread-pill {
			display: none;
		}

		.filter-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.filter .pill {
			position: relative;
			width: var(--touch-target);
			padding: 0;
			justify-content: center;
		}

		.mailbox:not(.selecting) .select-all {
			display: none;
		}

		.tool-btn,
		.pager-btn,
		.caret {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.pill {
			height: 2.25rem;
			padding: 0 0.875rem;
		}

		.row :global(.swipe-content) {
			grid-template-columns: auto 1fr;
			gap: 0.625rem;
			padding: 0.25rem 1rem;
			min-height: 4.5rem;
		}

		.mailbox:not(.selecting) .row :global(.swipe-content) {
			grid-template-columns: minmax(0, 1fr);
		}

		.mailbox:not(.selecting) .row :global(.check) {
			display: none;
		}

		.star {
			display: none;
		}

		.row-link {
			grid-template-columns: 2.5rem minmax(0, 1fr) auto;
			grid-template-areas:
				'avatar sender date'
				'avatar body body';
			gap: 0.15rem 0.75rem;
			padding: 0.75rem 0;
		}

		.avatar {
			grid-area: avatar;
			align-self: center;
			width: 2.5rem;
			height: 2.5rem;
			font-size: 0.8125rem;
		}

		.indicators {
			display: none;
		}

		.sender {
			grid-area: sender;
			font-size: 0.9375rem;
		}

		.date {
			grid-area: date;
		}

		.body {
			grid-area: body;
		}

		.row-actions {
			display: none !important;
		}

		.title {
			font-size: 1.0625rem;
		}

		.list-foot {
			display: none;
		}

		.pager-single {
			display: none;
		}

		.menu-item {
			min-height: var(--touch-target);
			padding: 0.75rem 0.875rem;
			font-size: 0.9375rem;
		}
	}
</style>
