<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';
	import DomainSwitcher from './DomainSwitcher.svelte';
	import type { Domain, MailboxCounts } from '$lib/types';

	let {
		counts,
		domains,
		activeDomainId,
		isAdmin,
		collapsed = $bindable(false),
		mobileOpen = $bindable(false)
	}: {
		counts: MailboxCounts;
		domains: Domain[];
		activeDomainId: string | null;
		isAdmin: boolean;
		collapsed?: boolean;
		mobileOpen?: boolean;
	} = $props();

	type NavItem = {
		href: string;
		icon: string;
		label: string;
		/** Bold pill (unread) vs. plain total. */
		badge?: number;
		count?: number;
	};

	const mailboxes = $derived<NavItem[]>([
		{ href: '/inbox', icon: 'inbox-line', label: 'Inbox', badge: counts.inbox_unread },
		{ href: '/drafts', icon: 'draft-line', label: 'Drafts', count: counts.drafts },
		{ href: '/sent', icon: 'send-plane-line', label: 'Sent' },
		{ href: '/starred', icon: 'star-line', label: 'Starred', count: counts.starred },
		{ href: '/trash', icon: 'delete-bin-line', label: 'Trash', count: counts.trash }
	]);

	const tools = $derived<NavItem[]>([
		{ href: '/settings', icon: 'user-settings-line', label: 'Settings' },
		...(isAdmin ? [{ href: '/admin', icon: 'settings-3-line', label: 'Admin' }] : [])
	]);

	function isActive(href: string): boolean {
		return $page.url.pathname === href || $page.url.pathname.startsWith(`${href}/`);
	}
</script>

{#if mobileOpen}
	<button
		type="button"
		class="scrim"
		aria-label="Close navigation"
		onclick={() => (mobileOpen = false)}
	></button>
{/if}

<aside class="sidebar" class:collapsed class:mobile-open={mobileOpen}>
	<div class="sidebar-top">
		<a href="/inbox" class="brand" title="Mail">
			<Logo size={30} />
			{#if !collapsed}<span class="brand-name">Mail</span>{/if}
		</a>
	</div>

	<a href="/compose" class="new-message" title="New message">
		<Icon name="pencil-line" size={collapsed ? 18 : 16} />
		{#if !collapsed}<span>New message</span>{/if}
	</a>

	<nav class="nav">
		{#each mailboxes as item (item.href)}
			<a
				href={item.href}
				class="nav-link"
				class:active={isActive(item.href)}
				title={collapsed ? item.label : undefined}
				onclick={() => (mobileOpen = false)}
			>
				<Icon name={item.icon} size={17} />
				{#if !collapsed}
					<span class="nav-label">{item.label}</span>
					{#if item.badge}
						<span class="nav-badge">{item.badge}</span>
					{:else if item.count}
						<span class="nav-count">{item.count}</span>
					{/if}
				{:else if item.badge}
					<span class="nav-dot"></span>
				{/if}
			</a>
		{/each}
	</nav>

	{#if !collapsed && domains.length > 0}
		<div class="section">
			<p class="section-title">Domains</p>
			<div class="section-body">
				<DomainSwitcher {domains} {activeDomainId} block />
			</div>
		</div>
	{/if}

	<nav class="nav nav-tools">
		{#each tools as item (item.href)}
			<a
				href={item.href}
				class="nav-link"
				class:active={isActive(item.href)}
				title={collapsed ? item.label : undefined}
				onclick={() => (mobileOpen = false)}
			>
				<Icon name={item.icon} size={17} />
				{#if !collapsed}<span class="nav-label">{item.label}</span>{/if}
			</a>
		{/each}
	</nav>

	<div class="sidebar-foot">
		<button
			type="button"
			class="collapse-btn"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			onclick={() => (collapsed = !collapsed)}
		>
			<Icon name={collapsed ? 'arrow-right-double-line' : 'arrow-left-double-line'} size={15} />
		</button>
	</div>
</aside>

<style>
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		width: var(--sidebar-width);
		padding: 0.875rem 0.75rem 0.75rem;
		background: var(--color-surface);
		box-shadow: inset -1px 0 0 var(--color-line);
		transition: width 0.18s ease, transform 0.18s ease;
	}

	.sidebar.collapsed {
		width: var(--sidebar-width-collapsed);
		padding-left: 0.5rem;
		padding-right: 0.5rem;
	}

	.sidebar-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.25rem 0.875rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.new-message {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4375rem;
		height: 2.5rem;
		margin-bottom: 1rem;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: var(--shadow-xs);
		transition: background 0.15s;
	}

	.new-message:hover {
		background: var(--color-accent-hover);
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.nav-tools {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.nav-link {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		height: 2.25rem;
		padding: 0 0.625rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.sidebar.collapsed .nav-link {
		justify-content: center;
		padding: 0;
	}

	.nav-link:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.nav-link.active {
		background: var(--color-surface-hover);
		color: var(--color-text);
		font-weight: 500;
	}

	.nav-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-badge {
		min-width: 1.25rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		text-align: center;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.nav-count {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.nav-dot {
		position: absolute;
		top: 0.4375rem;
		right: 0.6875rem;
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 9999px;
		background: var(--color-accent);
	}

	.section {
		margin-top: 1.125rem;
	}

	.section-title {
		padding: 0 0.625rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-muted);
	}

	.section-body {
		margin-top: 0.375rem;
	}

	.sidebar-foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.75rem;
	}

	.collapse-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.875rem;
		height: 1.875rem;
		margin-left: auto;
		border-radius: 0.5rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
		transition: background 0.15s, color 0.15s;
	}

	.collapse-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 35;
		background: var(--color-scrim);
	}

	@media (max-width: 900px) {
		.sidebar {
			transform: translateX(-100%);
			box-shadow: var(--shadow-md);
		}

		.sidebar.mobile-open {
			transform: none;
		}

		.scrim {
			display: block;
		}
	}

	@media (min-width: 901px) {
		.scrim {
			display: none;
		}
	}
</style>
