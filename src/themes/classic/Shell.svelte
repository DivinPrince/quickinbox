<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
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

	const NARROW = ['/mail', '/settings'];
	const narrow = $derived(NARROW.some((path) => $page.url.pathname.startsWith(path)));
	const stacked = $derived(isStackedPath($page.url.pathname));
	const mailbox = $derived(isMailboxPath($page.url.pathname));
	const utility = $derived(isUtilityPath($page.url.pathname));

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
		/>

		<main class="app-main" class:app-main-narrow={narrow}>
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
			domains={data.domains}
			activeDomainId={data.activeDomainId}
			isAdmin={data.user.is_admin}
			accounts={data.accounts}
			onLogout={logout}
			onLogoutAll={logoutAll}
		/>
	{/if}
</div>
