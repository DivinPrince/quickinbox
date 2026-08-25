<script lang="ts">
	import './layout.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import MobileChrome from '$lib/components/MobileChrome.svelte';
	import SwipeBack from '$lib/components/SwipeBack.svelte';
	import { disablePushForCurrentAccount } from '$lib/push-client';
	import { watchSystemTheme } from '$lib/theme';
	import {
		captureInstallPrompt,
		isMailboxPath,
		isStackedPath,
		isStandaloneDisplay,
		isUtilityPath,
		noteInAppNavigation,
		registerAppServiceWorker
	} from '$lib/app-chrome';
	import { setupMobileViewTransitions } from '$lib/view-transitions';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Onboarding runs before the user has an address, so the shell would be empty.
	const showShell = $derived(Boolean(data.user) && $page.url.pathname !== '/onboarding');

	// Thread and settings read better as a centred column. Compose needs the
	// full desktop pane — a 48rem cap makes it look like a phone form.
	const NARROW = ['/mail', '/settings'];
	const narrow = $derived(NARROW.some((path) => $page.url.pathname.startsWith(path)));
	const stacked = $derived(isStackedPath($page.url.pathname));
	const mailbox = $derived(isMailboxPath($page.url.pathname));
	const utility = $derived(isUtilityPath($page.url.pathname));

	let collapsed = $state(false);

	setupMobileViewTransitions();

	afterNavigate((navigation) => {
		noteInAppNavigation(navigation.type);
	});

	// app.html already applied the theme; this keeps "System" live afterwards.
	$effect(() => watchSystemTheme());

	$effect(() => {
		registerAppServiceWorker();
		captureInstallPrompt();
	});

	$effect(() => {
		const syncStandalone = () => {
			document.documentElement.dataset.standalone = isStandaloneDisplay() ? 'true' : 'false';
		};
		syncStandalone();
		const standalone = window.matchMedia('(display-mode: standalone)');
		const fullscreen = window.matchMedia('(display-mode: fullscreen)');
		standalone.addEventListener('change', syncStandalone);
		fullscreen.addEventListener('change', syncStandalone);
		return () => {
			standalone.removeEventListener('change', syncStandalone);
			fullscreen.removeEventListener('change', syncStandalone);
		};
	});

	// Remember the collapsed sidebar between visits.
	$effect(() => {
		collapsed = localStorage.getItem('mail:sidebar-collapsed') === '1';
	});

	function toggleCollapsed(next: boolean) {
		localStorage.setItem('mail:sidebar-collapsed', next ? '1' : '0');
	}

	$effect(() => {
		toggleCollapsed(collapsed);
	});

	async function logout() {
		try {
			await disablePushForCurrentAccount();
		} catch (error) {
			console.warn('Could not fully remove the push subscription during logout', error);
		} finally {
			await fetch('/api/auth/login', { method: 'DELETE' });
			window.location.href = '/login';
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
		rel="stylesheet"
		media="(min-width: 901px)"
	/>
</svelte:head>

{#if showShell}
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
			isAdmin={data.user!.is_admin}
			bind:collapsed
		/>

		<div class="app-content">
			<Topbar
				userName={data.user!.name}
				userEmail={data.user!.email}
				addresses={data.addresses}
				onLogout={logout}
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
				isAdmin={data.user!.is_admin}
				onLogout={logout}
			/>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}
