<script lang="ts">
	import './layout.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import { watchSystemTheme } from '$lib/theme';
	import {
		captureInstallPrompt,
		isStandaloneDisplay,
		noteInAppNavigation,
		registerAppServiceWorker
	} from '$lib/app-chrome';
	import { setupMobileViewTransitions } from '$lib/view-transitions';
	import { persistUiTheme } from '$lib/ui-theme/apply';
	import { persistLocale } from '$lib/i18n';
	import { getTheme } from '$lib/ui-theme/registry';
	import type { ThemeShellData } from '$lib/ui-theme/types';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const showShell = $derived(
		Boolean(data.user) &&
			$page.url.pathname !== '/onboarding' &&
			$page.url.pathname !== '/account/setup'
	);
	const ThemeShell = $derived(getTheme(data.uiTheme).Shell);
	const shellData = $derived.by((): ThemeShellData | null => {
		if (!data.user) return null;
		return {
			user: data.user,
			domains: data.domains,
			addresses: data.addresses,
			activeDomainId: data.activeDomainId,
			counts: data.counts,
			uiTheme: data.uiTheme
		};
	});

	setupMobileViewTransitions();

	afterNavigate((navigation) => {
		noteInAppNavigation(navigation.type);
	});

	$effect(() => watchSystemTheme());

	$effect(() => {
		if (data.user) persistUiTheme(data.uiTheme);
	});

	$effect(() => {
		persistLocale(data.locale);
	});

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
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if data.uiTheme === 'classic'}
		<link
			href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
			rel="stylesheet"
			media="(min-width: 901px)"
		/>
	{/if}
</svelte:head>

{#if showShell && shellData}
	<ThemeShell data={shellData}>
		{@render children()}
	</ThemeShell>
{:else}
	{@render children()}
{/if}
