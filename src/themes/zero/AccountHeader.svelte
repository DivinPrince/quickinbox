<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { initials } from '$lib/mail/folders';
	import { setThemePreference } from '$lib/theme';
	import type { MailAddress } from '$lib/types';
	import type { ThemeShellData } from '$lib/ui-theme/types';
	import Icon from './icons/Icon.svelte';

	let {
		data,
		collapsed,
		onLogout
	}: {
		data: ThemeShellData;
		collapsed: boolean;
		onLogout: () => Promise<void>;
	} = $props();

	let menuOpen = $state(false);
	let extraOpen = $state(false);
	let switching = $state(false);

	const filteredId = $derived($page.url.searchParams.get('address'));
	const active = $derived(
		data.addresses.find((address) => address.id === filteredId) ??
			data.addresses.find((address) => address.is_default) ??
			data.addresses[0] ??
			null
	);
	const others = $derived(data.addresses.filter((address) => address.id !== active?.id));
	const shownOthers = $derived(others.slice(0, 2));
	const extra = $derived(others.slice(2));
	const displayName = $derived(active?.label || data.user.name || 'Account');
	const displayEmail = $derived(active?.address ?? data.user.email);

	function tileLabel(address: MailAddress): string {
		if (address.label?.trim()) return initials(address.label);
		const [local, domain] = address.address.split('@');
		if (local && domain) {
			return `${local[0] ?? '?'}${domain[0] ?? '?'}`.toUpperCase();
		}
		return (local ?? address.address).slice(0, 2).toUpperCase();
	}

	function closeMenus() {
		menuOpen = false;
		extraOpen = false;
	}

	async function selectAddress(address: MailAddress) {
		if (switching || address.id === active?.id) {
			closeMenus();
			return;
		}

		switching = true;
		closeMenus();
		try {
			const url = new URL($page.url);
			url.searchParams.set('address', address.id);
			url.searchParams.delete('thread');
			if (address.domain_id !== data.activeDomainId) {
				await fetch('/api/domains/select', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ domainId: address.domain_id })
				});
				window.location.assign(`${url.pathname}${url.search}`);
				return;
			}
			await goto(`${url.pathname}${url.search}`, { noScroll: true });
		} finally {
			switching = false;
		}
	}

	function toggleAppearance() {
		const dark = document.documentElement.dataset.theme === 'dark';
		setThemePreference(dark ? 'light' : 'dark');
		closeMenus();
	}

	function onDocPointer(event: PointerEvent) {
		const target = event.target as HTMLElement | null;
		if (!target?.closest('.z-account')) closeMenus();
	}
</script>

<svelte:window onpointerdown={onDocPointer} />

<div class="z-account" class:collapsed>
	{#if collapsed}
		<button
			type="button"
			class="z-tile"
			class:active
			aria-label={displayEmail}
			onclick={() => (menuOpen = !menuOpen)}
		>
			{active ? tileLabel(active) : initials(data.user.name || data.user.email)}
		</button>
	{:else}
		<div class="z-account-row">
			<div class="z-tiles">
				{#if active}
					<div class="z-tile-wrap">
						<button
							type="button"
							class="z-tile active"
							title={active.address}
							aria-current="true"
							onclick={() => selectAddress(active)}
						>
							{tileLabel(active)}
						</button>
						{#if others.length > 0}
							<span class="z-tile-check" aria-hidden="true">
								<Icon name="CircleCheck" size={16} />
							</span>
						{/if}
					</div>
				{/if}
				{#each shownOthers as address (address.id)}
					<button
						type="button"
						class="z-tile"
						title={address.address}
						onclick={() => selectAddress(address)}
					>
						{tileLabel(address)}
					</button>
				{/each}
				{#if extra.length > 0}
					<div class="z-extra">
						<button
							type="button"
							class="z-tile extra"
							aria-label="More addresses"
							onclick={() => (extraOpen = !extraOpen)}
						>
							+{extra.length}
						</button>
						{#if extraOpen}
							<div class="z-menu z-extra-menu">
								{#each extra as address (address.id)}
									<button type="button" onclick={() => selectAddress(address)}>
										<span class="z-tile">{tileLabel(address)}</span>
										<span>
											<strong>{address.label || address.address}</strong>
											{#if address.label}
												<small>{address.address}</small>
											{/if}
										</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<a
					href="/settings/connections"
					class="z-tile add"
					aria-label="Add address"
					title="Add address"
				>
					<Icon name="Plus" size={14} />
				</a>
			</div>
			<button
				type="button"
				class="z-dots"
				aria-label="Account menu"
				onclick={() => (menuOpen = !menuOpen)}
			>
				<Icon name="ThreeDots" size={16} />
			</button>
		</div>

		<div class="z-account-meta">
			<p class="z-user-name">{displayName}</p>
			<p class="z-user-email">{displayEmail}</p>
		</div>
	{/if}

	{#if menuOpen}
		<div class="z-menu z-account-menu">
			{#if collapsed && data.addresses.length > 0}
				<p class="z-menu-label">Addresses</p>
				{#each data.addresses as address (address.id)}
					<button type="button" onclick={() => selectAddress(address)}>
						<span class="z-tile">{tileLabel(address)}</span>
						<span>
							<strong>{address.label || address.address}</strong>
							{#if address.label}
								<small>{address.address}</small>
							{/if}
						</span>
					</button>
				{/each}
				<a href="/settings/connections" onclick={closeMenus}>
					<Icon name="Plus" size={16} />
					Add address
				</a>
			{/if}
			<a href="/settings/general" onclick={closeMenus}>
				<Icon name="SettingsGear" size={16} />
				Settings
			</a>
			<button type="button" onclick={toggleAppearance}>
				<Icon name="Stars" size={16} />
				App theme
			</button>
			<button type="button" class="logout" onclick={() => onLogout()}>
				<Icon name="ArrowLeft" size={16} />
				Log out
			</button>
		</div>
	{/if}
</div>
