<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import SplitLayoutPicker, { type SplitLayout } from '$lib/components/SplitLayoutPicker.svelte';
	import { CLASSIC_LAYOUT, type ClassicLayoutContext } from './layout';
	import MobileChrome from '$lib/components/MobileChrome.svelte';
	import SwipeBack from '$lib/components/SwipeBack.svelte';
	import { logoutAccount } from '$lib/account-switch';
	import {
		isMailboxPath,
		isStackedPath,
		isUtilityPath,
		noteInAppNavigation
	} from '$lib/app-chrome';
	import type { ThemeShellProps } from '$lib/ui-theme/types';

	let { data, children }: ThemeShellProps = $props();

	const NARROW = ['/settings'];
	const narrow = $derived(NARROW.some((path) => $page.url.pathname.startsWith(path)));
	const stacked = $derived(isStackedPath($page.url.pathname));
	const mailbox = $derived(isMailboxPath($page.url.pathname));
	const utility = $derived(isUtilityPath($page.url.pathname));
	const organizer = $derived($page.url.pathname === '/contacts' || $page.url.pathname === '/calendar');
	const canSplit = $derived(mailbox && $page.url.pathname !== '/drafts');
	let layout = $state<SplitLayout>('none');
	setContext<ClassicLayoutContext>(CLASSIC_LAYOUT, { get value() { return layout; } });

	onMount(() => {
		try {
			const saved = localStorage.getItem('quickinbox:classic-split-layout');
			if (saved === 'vertical' || saved === 'horizontal') layout = saved;
		} catch { /* Use the default when browser storage is unavailable. */ }
	});

	function chooseLayout(next: SplitLayout) {
		layout = next;
		try { localStorage.setItem('quickinbox:classic-split-layout', next); } catch { /* Optional persistence. */ }
	}

	let collapsed = $state(false);

	afterNavigate((navigation) => {
		noteInAppNavigation(navigation.type);
	});

	$effect(() => {
		const stored =
			localStorage.getItem('quickinbox:sidebar-collapsed') ??
			localStorage.getItem('mail:sidebar-collapsed');
		collapsed = stored === '1';
	});

	function toggleCollapsed(next: boolean) {
		localStorage.setItem('quickinbox:sidebar-collapsed', next ? '1' : '0');
	}

	$effect(() => {
		toggleCollapsed(collapsed);
	});

	// With other accounts signed in, logging out lands in the next one's inbox.
	const logout = () => logoutAccount();
	const logoutAll = () => logoutAccount(true);
</script>

<div
	class="app-shell"
	data-collapsed={collapsed}
	data-stacked={stacked}
	data-mailbox={mailbox}
	data-utility={utility}
>
	<Sidebar
		counts={data.counts}
		labels={data.labels}
		domains={data.domains}
		activeDomainId={data.activeDomainId}
		isAdmin={data.user.is_admin}
		bind:collapsed
	/>

	<div class="app-content">
		<Topbar
			userName={data.user.name}
			userEmail={data.user.email}
			addresses={data.addresses}
			accounts={data.accounts}
			onLogout={logout}
			onLogoutAll={logoutAll}
		>
			{#snippet actions()}
				{#if canSplit}
					<div class="classic-layout-action">
						<SplitLayoutPicker value={layout} onChange={chooseLayout} />
					</div>
				{/if}
			{/snippet}
		</Topbar>

		<main class="app-main" class:app-main-narrow={narrow} class:app-main-organizer={organizer} class:app-main-split={canSplit && layout !== 'none'}>
			{#if stacked}
				<SwipeBack href="/inbox">
					{@render children()}
				</SwipeBack>
			{:else}
				{@render children()}
			{/if}
		</main>
	</div>

	{#if !stacked}
		<MobileChrome
			counts={data.counts}
			labels={data.labels}
			domains={data.domains}
			activeDomainId={data.activeDomainId}
			isAdmin={data.user.is_admin}
			accounts={data.accounts}
			onLogout={logout}
			onLogoutAll={logoutAll}
		/>
	{/if}
</div>

<style>
	.app-main.app-main-organizer { padding:0; height:calc(100dvh - var(--topbar-height)); flex:none; overflow:hidden; }
	@media(max-width:900px) { .app-main.app-main-organizer { height:calc(100dvh - var(--bottom-nav-height) - env(safe-area-inset-bottom)); padding:0; } }
	@media (min-width: 901px) {
		.app-main-split {
			flex: none;
			height: calc(100dvh - var(--topbar-height));
			min-height: 0;
			padding: 0;
			overflow: hidden;
		}
	}

	@media (max-width: 900px) {
		.classic-layout-action { display: none; }
	}
</style>
