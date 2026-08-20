<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import { disablePushForCurrentAccount } from '$lib/push-client';
	import { watchSystemTheme } from '$lib/theme';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Onboarding runs before the user has an address, so the shell would be empty.
	const showShell = $derived(Boolean(data.user) && $page.url.pathname !== '/onboarding');

	// Pages that read better centred than full-bleed.
	const NARROW = ['/compose', '/mail', '/settings'];
	const narrow = $derived(NARROW.some((path) => $page.url.pathname.startsWith(path)));

	let collapsed = $state(false);
	let mobileOpen = $state(false);

	// app.html already applied the theme; this keeps "System" live afterwards.
	$effect(() => watchSystemTheme());

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
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{#if showShell}
	<div class="app-shell" data-collapsed={collapsed}>
		<Sidebar
			counts={data.counts}
			domains={data.domains}
			activeDomainId={data.activeDomainId}
			isAdmin={data.user!.is_admin}
			bind:collapsed
			bind:mobileOpen
		/>

		<div class="app-content">
			<Topbar
				userName={data.user!.name}
				userEmail={data.user!.email}
				addresses={data.addresses}
				onToggleNav={() => (mobileOpen = !mobileOpen)}
				onLogout={logout}
			/>

			<main class="app-main" class:app-main-narrow={narrow}>
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
