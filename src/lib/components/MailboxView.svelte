<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import Icon from './Icon.svelte';
	import Check from './Check.svelte';
	import EmptyState from './EmptyState.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import { formatRelativeDate } from '$lib/utils/date';
	import type { MailboxFilters, MailboxPage, MailboxView, ThreadSummary } from '$lib/types';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	const META: Record<MailboxView, { title: string; icon: string; empty: string }> = {
		inbox: { title: 'Inbox', icon: 'inbox-line', empty: 'Your inbox is empty' },
		starred: { title: 'Starred', icon: 'star-line', empty: 'No starred messages' },
		drafts: { title: 'Drafts', icon: 'draft-line', empty: 'No drafts saved' },
		sent: { title: 'Sent', icon: 'send-plane-line', empty: 'Nothing sent yet' },
		trash: { title: 'Trash', icon: 'delete-bin-line', empty: 'Trash is empty' }
	};

	const meta = $derived(META[view]);

	// Local copy so stars and reads can flip before the server round trip lands.
	let items = $state<ThreadSummary[]>([]);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let filterOpen = $state(false);
	let moreOpen = $state(false);
	let selectMenuOpen = $state(false);

	$effect(() => {
		items = mailbox.threads;
		selected = [];
	});

	const allSelected = $derived(items.length > 0 && selected.length === items.length);
	const someSelected = $derived(selected.length > 0);
	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly].filter(Boolean).length
	);

	/**
	 * Who to show on the row. Sent and Drafts are about where a message went, so
	 * they name the recipient; everywhere else names the people in the thread.
	 */
	function people(thread: ThreadSummary): string {
		if (view === 'drafts' || (view === 'sent' && thread.participants.every((p) => p.self))) {
			return recipientOf(thread) || (view === 'drafts' ? 'No recipient' : 'Unknown');
		}

		return thread.participants.map((participant) => participant.label).join(', ');
	}

	function recipientOf(thread: ThreadSummary): string {
		const [first] = thread.participants;
		return first?.address ? first.address.split('@')[0].replace(/[._-]+/g, ' ') : '';
	}

	function initial(thread: ThreadSummary): string {
		const external = thread.participants.find((participant) => !participant.self);
		return ((external ?? thread.participants[0])?.address[0] ?? '?').toUpperCase();
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
		busy = true;
		try {
			await fetch('/api/mail/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids })
			});
			selected = [];
			await invalidateAll();
		} finally {
			busy = false;
			moreOpen = false;
		}
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

<section class="mailbox">
	<header class="toolbar">
		<div class="toolbar-left">
			<div class="select-all">
				<Check
					label="Select all messages"
					checked={allSelected}
					indeterminate={someSelected && !allSelected}
					onchange={selectAll}
				/>
				<button
					type="button"
					class="caret"
					aria-label="Selection options"
					aria-expanded={selectMenuOpen}
					onclick={() => (selectMenuOpen = !selectMenuOpen)}
				>
					<Icon name="arrow-down-s-line" size={14} />
				</button>

				{#if selectMenuOpen}
					<button
						type="button"
						class="backdrop"
						aria-label="Close menu"
						onclick={() => (selectMenuOpen = false)}
					></button>
					<div class="menu menu-left" role="menu">
						<button type="button" class="menu-item" onclick={() => selectWhere(() => true)}>
							All
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere(() => false)}>
							None
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => !e.is_read)}>
							Unread
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_read)}>
							Read
						</button>
						<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_starred)}>
							Starred
						</button>
					</div>
				{/if}
			</div>

			{#if someSelected}
				<span class="selected-count">{selected.length} selected</span>

				<div class="bulk-actions">
					<button
						type="button"
						class="tool-btn"
						title="Mark as read"
						disabled={busy}
						onclick={() => run('read')}
					>
						<Icon name="mail-open-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Mark as unread"
						disabled={busy}
						onclick={() => run('unread')}
					>
						<Icon name="mail-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Star"
						disabled={busy}
						onclick={() => run('star')}
					>
						<Icon name="star-line" size={16} />
					</button>
					<button
						type="button"
						class="tool-btn"
						title="Remove star"
						disabled={busy}
						onclick={() => run('unstar')}
					>
						<Icon name="star-off-line" size={16} />
					</button>

					{#if view === 'trash'}
						<button
							type="button"
							class="tool-btn"
							title="Restore"
							disabled={busy}
							onclick={() => run('restore')}
						>
							<Icon name="arrow-go-back-line" size={16} />
						</button>
						<button
							type="button"
							class="tool-btn danger"
							title="Delete permanently"
							disabled={busy}
							onclick={() => run('delete')}
						>
							<Icon name="delete-bin-2-line" size={16} />
						</button>
					{:else}
						<button
							type="button"
							class="tool-btn"
							title="Move to trash"
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
						aria-label="Mailbox actions"
						aria-expanded={moreOpen}
						onclick={() => (moreOpen = !moreOpen)}
					>
						<Icon name="more-line" size={16} />
					</button>

					{#if moreOpen}
						<button
							type="button"
							class="backdrop"
							aria-label="Close menu"
							onclick={() => (moreOpen = false)}
						></button>
						<div class="menu menu-left" role="menu">
							<button type="button" class="menu-item" onclick={() => run('read-all', [])}>
								<Icon name="mail-open-line" size={15} /> Mark all as read
							</button>
							<button type="button" class="menu-item" onclick={() => invalidateAll()}>
								<Icon name="refresh-line" size={15} /> Refresh
							</button>
							{#if view === 'trash'}
								<button
									type="button"
									class="menu-item danger"
									onclick={() => run('empty-trash', [])}
								>
									<Icon name="delete-bin-2-line" size={15} /> Empty trash
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
				class="pill"
				class:pill-on={filters.unreadOnly}
				onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
			>
				Unread
			</button>

			<div class="filter">
				<button
					type="button"
					class="pill"
					class:pill-on={activeFilterCount > 0}
					aria-expanded={filterOpen}
					onclick={() => (filterOpen = !filterOpen)}
				>
					<Icon name="equalizer-line" size={14} />
					Filter
					{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
				</button>

				{#if filterOpen}
					<button
						type="button"
						class="backdrop"
						aria-label="Close filters"
						onclick={() => (filterOpen = false)}
					></button>
					<div class="menu menu-right" role="menu">
						<button
							type="button"
							class="menu-item"
							onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}
						>
							<Icon
								name={filters.unreadOnly ? 'checkbox-fill' : 'checkbox-blank-line'}
								size={15}
							/>
							Unread only
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
							Starred only
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
							Has attachments
						</button>
						{#if activeFilterCount > 0 || filters.q}
							<button
								type="button"
								class="menu-item"
								onclick={() =>
									apply({ unread: null, starred: null, attachments: null, q: null })}
							>
								<Icon name="close-circle-line" size={15} /> Clear all
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="pager">
				<a
					class="pager-btn"
					class:disabled={mailbox.page <= 1}
					href={withParams({ page: mailbox.page - 1 })}
					aria-label="Previous page"
				>
					<Icon name="arrow-left-s-line" size={16} />
				</a>
				<span class="pager-label">{mailbox.page}/{mailbox.pageCount}</span>
				<a
					class="pager-btn"
					class:disabled={mailbox.page >= mailbox.pageCount}
					href={withParams({ page: mailbox.page + 1 })}
					aria-label="Next page"
				>
					<Icon name="arrow-right-s-line" size={16} />
				</a>
			</div>
		</div>
	</header>

	{#if filters.q}
		<div class="search-note">
			<Icon name="search-line" size={14} />
			<span>{mailbox.total} result{mailbox.total === 1 ? '' : 's'} for “{filters.q}”</span>
			<a href={withParams({ q: null })} class="search-clear">Clear</a>
		</div>
	{/if}

	<div class="list">
		{#if items.length === 0}
			<EmptyState
				icon={filters.q ? 'search-line' : meta.icon}
				title={filters.q ? 'No messages match that search' : meta.empty}
			/>
		{:else}
			<ul>
				{#each items as thread (thread.thread_id)}
					<li
						class="row"
						class:unread={!thread.is_read}
						class:checked={selected.includes(thread.latest_id)}
					>
						<Check
							label={`Select conversation with ${people(thread)}`}
							checked={selected.includes(thread.latest_id)}
							onchange={() => toggle(thread.latest_id)}
						/>

						<button
							type="button"
							class="star"
							class:on={thread.is_starred}
							aria-label={thread.is_starred ? 'Remove star' : 'Add star'}
							onclick={() => toggleStar(thread)}
						>
							<Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={15} />
						</button>

						<a class="row-link" href={href(thread)}>
							<span class="avatar">{initial(thread)}</span>

							<span class="sender" title={people(thread)}>
								<span class="sender-names">{people(thread)}</span>
								{#if thread.message_count > 1}
									<span class="count">{thread.message_count}</span>
								{/if}
								{#if thread.is_draft}<span class="tag tag-draft">Draft</span>{/if}
							</span>

							<span class="body">
								<span class="subject">{thread.subject || '(no subject)'}</span>
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

							<span class="date">{formatRelativeDate(thread.created_at)}</span>
						</a>

						<span class="row-actions">
							{#if view === 'trash'}
								<button
									type="button"
									class="tool-btn"
									title="Restore"
									onclick={() => run('restore', [thread.latest_id])}
								>
									<Icon name="arrow-go-back-line" size={15} />
								</button>
								<button
									type="button"
									class="tool-btn danger"
									title="Delete permanently"
									onclick={() => run('delete', [thread.latest_id])}
								>
									<Icon name="delete-bin-2-line" size={15} />
								</button>
							{:else}
								<button
									type="button"
									class="tool-btn"
									title={thread.is_read ? 'Mark as unread' : 'Mark as read'}
									onclick={() => run(thread.is_read ? 'unread' : 'read', [thread.latest_id])}
								>
									<Icon name={thread.is_read ? 'mail-line' : 'mail-open-line'} size={15} />
								</button>
								<button
									type="button"
									class="tool-btn"
									title="Move to trash"
									onclick={() => run('trash', [thread.latest_id])}
								>
									<Icon name="delete-bin-line" size={15} />
								</button>
							{/if}
						</span>
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

<style>
	.mailbox {
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
		overflow: hidden;
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
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.875rem;
		background: var(--color-bg);
		box-shadow: inset 0 -1px 0 var(--color-line);
		transition: background 0.12s;
	}

	.row:last-child {
		box-shadow: none;
	}

	.row.unread {
		background: var(--color-surface);
	}

	.row:hover,
	.row.unread:hover {
		background: var(--color-surface-muted);
	}

	.row.checked,
	.row.checked:hover {
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
		text-transform: capitalize;
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

	@media (max-width: 780px) {
		.row-link {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'sender date'
				'body body';
			gap: 0.25rem 0.5rem;
		}

		.avatar,
		.indicators {
			display: none;
		}

		.sender {
			grid-area: sender;
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
			font-size: 0.9375rem;
		}
	}
</style>
