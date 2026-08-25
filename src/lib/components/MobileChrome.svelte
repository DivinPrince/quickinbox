<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import DomainSwitcher from './DomainSwitcher.svelte';
	import { haptic, isMailboxPath, isMorePath } from '$lib/app-chrome';
	import type { Domain, MailboxCounts } from '$lib/types';

	let {
		counts,
		domains,
		activeDomainId,
		isAdmin,
		onLogout
	}: {
		counts: MailboxCounts;
		domains: Domain[];
		activeDomainId: string | null;
		isAdmin: boolean;
		onLogout: () => void;
	} = $props();

	let moreOpen = $state(false);
	let sheetWasOpen = false;
	let sheetEl: HTMLDivElement | undefined;
	let trigger: HTMLButtonElement | undefined;

	$effect(() => {
		$page.url.pathname;
		moreOpen = false;
	});

	$effect(() => {
		if (moreOpen) {
			sheetWasOpen = true;
			queueMicrotask(() => sheetEl?.querySelector<HTMLElement>('a, button')?.focus());
			return;
		}
		if (sheetWasOpen) {
			sheetWasOpen = false;
			trigger?.focus({ preventScroll: true });
		}
	});

	$effect(() => {
		if (!moreOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') moreOpen = false;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const tabs = $derived([
		{ href: '/inbox', icon: 'inbox-line', iconActive: 'inbox-fill', label: 'Inbox', badge: counts.inbox_unread },
		{ href: '/starred', icon: 'star-line', iconActive: 'star-fill', label: 'Starred' },
		{ href: '/sent', icon: 'send-plane-line', iconActive: 'send-plane-fill', label: 'Sent' }
	]);

	function isTabActive(href: string): boolean {
		return $page.url.pathname === href;
	}

	const moreActive = $derived(isMorePath($page.url.pathname));
	const showFab = $derived(isMailboxPath($page.url.pathname));
</script>

<nav class="bottom-nav" aria-label="Primary">
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			class="tab"
			class:active={isTabActive(tab.href)}
			aria-current={isTabActive(tab.href) ? 'page' : undefined}
			onclick={() => haptic(8)}
		>
			<span class="tab-icon">
				<Icon name={isTabActive(tab.href) ? tab.iconActive : tab.icon} size={22} />
				{#if tab.badge}
					<span class="tab-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
				{/if}
			</span>
			<span class="tab-label">{tab.label}</span>
		</a>
	{/each}

	<button
		bind:this={trigger}
		type="button"
		class="tab"
		class:active={moreActive || moreOpen}
		aria-expanded={moreOpen}
		aria-controls="more-sheet"
		onclick={() => {
			haptic(8);
			moreOpen = !moreOpen;
		}}
	>
		<span class="tab-icon">
			<Icon name={moreOpen ? 'menu-fill' : 'menu-line'} size={22} />
			{#if counts.drafts > 0 && !moreOpen}
				<span class="tab-dot"></span>
			{/if}
		</span>
		<span class="tab-label">More</span>
	</button>
</nav>

<a
	href="/compose"
	class="compose-fab"
	class:hidden={moreOpen || !showFab}
	aria-label="New message"
	onclick={() => haptic(8)}
>
	<Icon name="pencil-fill" size={22} />
</a>

{#if moreOpen}
	<button type="button" class="sheet-scrim" aria-label="Close menu" onclick={() => (moreOpen = false)}
	></button>
	<div
		bind:this={sheetEl}
		class="sheet"
		id="more-sheet"
		role="dialog"
		aria-label="More"
		aria-modal="true"
	>
		<div class="sheet-handle" aria-hidden="true"></div>
		<nav class="sheet-nav">
			<a href="/drafts" class="sheet-link" class:active={$page.url.pathname === '/drafts'}>
				<Icon name="draft-line" size={20} />
				<span>Drafts</span>
				{#if counts.drafts}
					<span class="sheet-count">{counts.drafts}</span>
				{/if}
			</a>
			<a href="/trash" class="sheet-link" class:active={$page.url.pathname === '/trash'}>
				<Icon name="delete-bin-line" size={20} />
				<span>Trash</span>
				{#if counts.trash}
					<span class="sheet-count">{counts.trash}</span>
				{/if}
			</a>
			<a href="/settings" class="sheet-link" class:active={$page.url.pathname === '/settings'}>
				<Icon name="user-settings-line" size={20} />
				<span>Settings</span>
			</a>
			{#if isAdmin}
				<a href="/admin" class="sheet-link" class:active={$page.url.pathname === '/admin'}>
					<Icon name="settings-3-line" size={20} />
					<span>Admin</span>
				</a>
			{/if}
		</nav>

		{#if domains.length > 1}
			<div class="sheet-section">
				<p class="sheet-title">Domains</p>
				<DomainSwitcher {domains} {activeDomainId} block />
			</div>
		{/if}

		<!--
			The topbar's account menu is the only other way out, and it is hidden on
			phones for stacked and utility pages — so on Settings and Admin, where
			people go looking for it, there was no way to sign out at all.
		-->
		<div class="sheet-section">
			<button type="button" class="sheet-link sheet-logout" onclick={onLogout}>
				<Icon name="logout-box-r-line" size={20} />
				<span>Log out</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.bottom-nav {
		display: none;
	}

	.compose-fab {
		display: none;
	}

	@media (max-width: 900px) {
		.bottom-nav {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 40;
			display: flex;
			align-items: stretch;
			height: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
			padding: 0.25rem 0.25rem env(safe-area-inset-bottom);
			background: var(--color-surface);
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.tab {
			position: relative;
			display: flex;
			flex: 1;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.125rem;
			min-height: 2.75rem;
			border: 0;
			border-radius: 0.75rem;
			color: var(--color-muted);
			background: transparent;
			-webkit-tap-highlight-color: transparent;
		}

		.tab.active {
			color: var(--color-text);
		}

		.tab-icon {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 1.75rem;
			height: 1.75rem;
		}

		.tab-label {
			font-size: 0.625rem;
			font-weight: 500;
			letter-spacing: 0.01em;
		}

		.tab-badge {
			position: absolute;
			top: -0.25rem;
			right: -0.625rem;
			min-width: 1rem;
			padding: 0.0625rem 0.25rem;
			border-radius: 9999px;
			font-size: 0.5625rem;
			font-weight: 700;
			line-height: 1.15;
			text-align: center;
			color: var(--color-on-accent);
			background: var(--color-accent);
		}

		.tab-dot {
			position: absolute;
			top: 0;
			right: -0.125rem;
			width: 0.375rem;
			height: 0.375rem;
			border-radius: 9999px;
			background: var(--color-accent);
		}

		.compose-fab {
			position: fixed;
			right: 1rem;
			bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 0.875rem);
			z-index: 35;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 3.5rem;
			height: 3.5rem;
			border-radius: 9999px;
			color: var(--color-on-accent);
			background: var(--color-accent);
			box-shadow: var(--shadow-md);
			-webkit-tap-highlight-color: transparent;
		}

		.compose-fab:active {
			transform: scale(0.96);
		}

		.compose-fab.hidden {
			display: none;
		}

		.sheet-scrim {
			position: fixed;
			inset: 0;
			z-index: 45;
			border: 0;
			background: var(--color-scrim);
			animation: sheet-fade 180ms ease-out;
		}

		.sheet {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 50;
			padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			border-radius: 1.25rem 1.25rem 0 0;
			box-shadow: var(--shadow-md);
			animation: sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1);
		}

		.sheet-handle {
			width: 2.25rem;
			height: 0.25rem;
			margin: 0.25rem auto 1rem;
			border-radius: 9999px;
			background: var(--color-line);
		}

		.sheet-nav {
			display: flex;
			flex-direction: column;
			gap: 0.125rem;
		}

		.sheet-link {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			min-height: 2.75rem;
			padding: 0 0.75rem;
			border-radius: 0.75rem;
			font-size: 0.9375rem;
			color: var(--color-text-secondary);
		}

		.sheet-link.active {
			background: var(--color-surface-hover);
			color: var(--color-text);
			font-weight: 500;
		}

		.sheet-count {
			margin-left: auto;
			font-size: 0.8125rem;
			color: var(--color-muted);
		}

		.sheet-section {
			margin-top: 0.875rem;
			padding-top: 0.875rem;
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.sheet-logout {
			width: 100%;
			border: none;
			background: transparent;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.sheet-title {
			margin: 0 0 0.5rem 0.75rem;
			font-size: 0.6875rem;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--color-muted);
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
			.sheet,
			.sheet-scrim,
			.compose-fab:active {
				animation: none;
				transform: none;
			}
		}
	}
</style>
