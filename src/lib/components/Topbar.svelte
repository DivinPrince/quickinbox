<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { haptic } from '$lib/app-chrome';
	import { t } from '$lib/i18n';
	import Icon from './Icon.svelte';
	import LocaleSwitcher from './LocaleSwitcher.svelte';
	import type { MailAddress } from '$lib/types';

	let {
		userName,
		userEmail,
		addresses,
		onLogout
	}: {
		userName: string;
		userEmail: string;
		addresses: MailAddress[];
		onLogout: () => void;
	} = $props();

	// Search applies to whichever mailbox is open; anywhere else it lands in Inbox.
	const MAILBOXES = ['/inbox', '/sent', '/starred', '/drafts', '/trash'];
	const searchTarget = $derived(
		MAILBOXES.find((path) => $page.url.pathname === path) ?? '/inbox'
	);

	let query = $state('');
	let menuOpen = $state(false);

	// Keep the field in step with the URL (back button, cleared search, …).
	$effect(() => {
		query = $page.url.searchParams.get('q') ?? '';
	});

	// Recipients see the sending identity, not the login email.
	const primaryAddress = $derived(
		addresses.find((address) => address.is_default)?.address ?? addresses[0]?.address ?? userEmail
	);

	const initials = $derived(
		userName
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]!.toUpperCase())
			.join('') || '?'
	);

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const params = new URLSearchParams();
		if (query.trim()) params.set('q', query.trim());
		goto(`${searchTarget}${params.size ? `?${params}` : ''}`, { keepFocus: true });
	}

	function clearSearch() {
		query = '';
		goto(searchTarget, { keepFocus: true });
	}
</script>

<header class="topbar">
	<form class="search" onsubmit={submitSearch} role="search">
		<Icon name="search-line" size={16} />
		<input
			type="search"
			bind:value={query}
			placeholder={t('mailbox.searchMessages')}
			aria-label={t('mailbox.searchMessages')}
		/>
		{#if query}
			<button type="button" class="search-clear" aria-label={t('mailbox.clearSearch')} onclick={clearSearch}>
				<Icon name="close-line" size={15} />
			</button>
		{/if}
	</form>

	<div class="topbar-actions">
		<div class="locale-chip">
			<LocaleSwitcher />
		</div>
		<a
			href="/settings"
			class="icon-btn"
			aria-label={t('nav.settings')}
			class:active={$page.url.pathname === '/settings'}
		>
			<Icon name="settings-3-line" size={17} />
		</a>

		<div class="account">
			<button
				type="button"
				class="account-trigger"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={() => {
					haptic(8);
					menuOpen = !menuOpen;
				}}
			>
				<span class="account-text">
					<span class="account-name">{userName}</span>
					<span class="account-address">{primaryAddress}</span>
				</span>
				<span class="avatar">{initials}</span>
			</button>

			{#if menuOpen}
				<button
					type="button"
					class="menu-backdrop"
					aria-label={t('account.menu')}
					onclick={() => (menuOpen = false)}
				></button>
				<div class="menu" role="menu">
					<p class="menu-head">
						<span class="menu-name">{userName}</span>
						<span class="menu-address">{primaryAddress}</span>
					</p>
					<a href="/settings" class="menu-item" role="menuitem" onclick={() => (menuOpen = false)}>
						<Icon name="user-settings-line" size={15} /> {t('nav.settings')}
					</a>
					<button type="button" class="menu-item" role="menuitem" onclick={onLogout}>
						<Icon name="logout-box-r-line" size={15} /> {t('nav.logOut')}
					</button>
				</div>
			{/if}
		</div>
	</div>
</header>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: var(--topbar-height);
		padding: 0 1.25rem;
		background: var(--color-surface);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		max-width: 34rem;
		height: 2.25rem;
		padding: 0 0.75rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		color: var(--color-muted);
		transition: box-shadow 0.15s, background 0.15s;
	}

	.search:focus-within {
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.search input {
		flex: 1;
		min-width: 0;
		margin-left: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.search input::placeholder {
		color: var(--color-muted);
	}

	.search input::-webkit-search-cancel-button {
		display: none;
	}

	.search-clear {
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}

	.search-clear:hover {
		color: var(--color-text);
	}

	.topbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}

	.locale-chip {
		display: flex;
		align-items: center;
	}

	.locale-chip :global(.locale-trigger) {
		width: 2rem;
		height: 2rem;
		min-width: 2rem;
		border-radius: 0.5rem;
		font-size: 0.6875rem;
	}

	:global(.topbar .icon-btn.active) {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.account {
		position: relative;
	}

	.account-trigger {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.25rem 0.25rem 0.25rem 0.625rem;
		border-radius: 9999px;
		transition: background 0.15s;
	}

	.account-trigger:hover {
		background: var(--color-surface-muted);
	}

	.account-text {
		display: none;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.25;
	}

	.account-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.account-address {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.6875rem;
		color: var(--color-muted);
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
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 50;
		min-width: 13rem;
		padding: 0.375rem;
		background: var(--color-surface);
		border-radius: 0.875rem;
		box-shadow: var(--shadow-md);
	}

	.menu-head {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem 0.625rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.menu-name {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.menu-address {
		font-size: 0.75rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 0.125rem;
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

	@media (min-width: 901px) {
		.account-text {
			display: flex;
		}
	}

	@media (max-width: 900px) {
		.topbar {
			height: calc(var(--topbar-height) + env(safe-area-inset-top));
			padding: env(safe-area-inset-top) 0.75rem 0;
			gap: 0.5rem;
		}

		.search {
			height: 2.75rem;
			max-width: none;
			border-radius: 9999px;
		}

		.search input {
			font-size: 16px;
		}

		:global(.topbar .icon-btn) {
			display: none;
		}

		.account-trigger {
			width: var(--touch-target);
			height: var(--touch-target);
			padding: 0;
			justify-content: center;
		}

		.avatar {
			width: 2.25rem;
			height: 2.25rem;
		}

		.menu-backdrop {
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

		.menu-item {
			min-height: var(--touch-target);
			font-size: 0.9375rem;
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
			.menu-backdrop {
				animation: none;
			}
		}
	}

	@media (max-width: 900px) {
		:global(.app-shell[data-stacked='true'] .topbar),
		:global(.app-shell[data-utility='true'] .topbar) {
			display: none;
		}
	}
</style>
