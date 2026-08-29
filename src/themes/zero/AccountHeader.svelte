<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import { initials } from '$lib/mail/folders';
	import { setThemePreference } from '$lib/theme';
	import { t } from '$lib/i18n';
	import Tooltip from '$lib/components/Tooltip.svelte';
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
	let localeOpen = $state(false);
	let switching = $state(false);
	let darkMode = $state(false);

	$effect(() => {
		darkMode = document.documentElement.dataset.theme === 'dark';
	});

	const filteredId = $derived($page.url.searchParams.get('address'));
	const active = $derived(
		data.addresses.find((address) => address.id === filteredId) ??
			data.addresses.find((address) => address.is_default) ??
			data.addresses[0] ??
			null
	);
	const shown = $derived(data.addresses.slice(0, 3));
	const extra = $derived(data.addresses.slice(3));
	const displayName = $derived(active?.label || data.user.name || t('account.account'));
	const displayEmail = $derived(active?.address ?? data.user.email);

	function tileLabel(address: MailAddress): string {
		if (address.label?.trim()) return initials(address.label);
		const [local, domain] = address.address.split('@');
		if (local && domain) {
			return `${local[0] ?? '?'}${domain[0] ?? '?'}`.toUpperCase();
		}
		return (local ?? address.address).slice(0, 2).toUpperCase();
	}

	function addressTip(address: MailAddress): string {
		const label = address.label?.trim();
		if (label && label.toLowerCase() !== address.address.toLowerCase()) {
			return `${label} · ${address.address}`;
		}
		return address.address;
	}

	function closeMenus() {
		menuOpen = false;
		extraOpen = false;
		localeOpen = false;
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

	function toggleMode() {
		const next = darkMode ? 'light' : 'dark';
		setThemePreference(next);
		darkMode = next === 'dark';
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
		<Tooltip text={displayEmail}>
			<button
				type="button"
				class="z-tile"
				class:active
				aria-label={displayEmail}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={() => {
					extraOpen = false;
					localeOpen = false;
					menuOpen = !menuOpen;
				}}
			>
				{active ? tileLabel(active) : initials(data.user.name || data.user.email)}
			</button>
		</Tooltip>
	{:else}
		<div class="z-account-row">
			<div class="z-tiles">
				{#each shown as address (address.id)}
					{@const selected = address.id === active?.id}
					<div class="z-tile-wrap">
						<Tooltip text={addressTip(address)}>
							<button
								type="button"
								class="z-tile"
								class:active={selected}
								aria-current={selected ? 'true' : undefined}
								aria-label={addressTip(address)}
								onclick={() => selectAddress(address)}
							>
								{tileLabel(address)}
							</button>
						</Tooltip>
						{#if selected && data.addresses.length > 1}
							<span class="z-tile-check" aria-hidden="true">
								<Icon name="CircleCheck" size={16} />
							</span>
						{/if}
					</div>
				{/each}
				{#if extra.length > 0}
					<div class="z-extra">
						<Tooltip text={t('account.moreAddresses')} enabled={!extraOpen}>
							<button
								type="button"
								class="z-tile extra"
								aria-label={t('account.moreAddresses')}
								aria-haspopup="menu"
								aria-expanded={extraOpen}
								onclick={() => {
									menuOpen = false;
									localeOpen = false;
									extraOpen = !extraOpen;
								}}
							>
								+{extra.length}
							</button>
						</Tooltip>
						{#if extraOpen}
							<div class="z-menu z-extra-menu">
								{#each extra as address (address.id)}
									<button
										type="button"
										aria-current={address.id === active?.id ? 'true' : undefined}
										onclick={() => selectAddress(address)}
									>
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
				<Tooltip text={t('account.addAddress')}>
					<a href="/settings/connections" class="z-tile add" aria-label={t('account.addAddress')}>
						<Icon name="Plus" size={14} />
					</a>
				</Tooltip>
			</div>
			<div class="z-account-actions">
				<LocaleSwitcher
					bind:open={localeOpen}
					onOpen={() => {
						menuOpen = false;
						extraOpen = false;
					}}
				/>
				<Tooltip text={t('account.menu')} enabled={!menuOpen}>
					<button
						type="button"
						class="z-dots"
						aria-label={t('account.menu')}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={() => {
							extraOpen = false;
							localeOpen = false;
							menuOpen = !menuOpen;
						}}
					>
						<Icon name="ThreeDots" size={16} />
					</button>
				</Tooltip>
			</div>
		</div>

		<div class="z-account-meta">
			<p class="z-user-name">{displayName}</p>
			<p class="z-user-email">{displayEmail}</p>
		</div>
	{/if}

	{#if menuOpen}
		<div class="z-menu z-account-menu">
			{#if collapsed && data.addresses.length > 0}
				<p class="z-menu-label">{t('account.addresses')}</p>
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
					{t('account.addAddress')}
				</a>
			{/if}
			{#if collapsed}
				<LocaleSwitcher embedded />
			{/if}
			<a href="/settings/general" onclick={closeMenus}>
				<Icon name="SettingsGear" size={16} />
				{t('nav.settings')}
			</a>
			<button type="button" onclick={toggleMode}>
				{#if darkMode}
					<Icon name="Sun" size={16} />
					{t('account.lightMode')}
				{:else}
					<Icon name="Moon" size={16} />
					{t('account.darkMode')}
				{/if}
			</button>
			<button type="button" class="logout" onclick={() => onLogout()}>
				<Icon name="ArrowLeft" size={16} />
				{t('nav.logOut')}
			</button>
		</div>
	{/if}
</div>
