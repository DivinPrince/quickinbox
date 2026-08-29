<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { disablePushForCurrentAccount } from '$lib/push-client';
	import { t } from '$lib/i18n';
	import type { ThemeShellProps } from '$lib/ui-theme/types';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import AccountHeader from './AccountHeader.svelte';
	import Icon from './icons/Icon.svelte';
	import CommandPalette from './overlays/CommandPalette.svelte';
	import ComposeDialog from './overlays/ComposeDialog.svelte';
	import ShortcutsSheet from './overlays/ShortcutsSheet.svelte';
	import './tokens.css';
	import './shell.css';

	let { data, children }: ThemeShellProps = $props();

	let collapsed = $state(false);
	let mobileOpen = $state(false);
	let paletteOpen = $state(false);
	let shortcutsOpen = $state(false);
	let chord = $state('');

	const pathname = $derived($page.url.pathname);
	const settings = $derived(pathname.startsWith('/settings') || pathname.startsWith('/admin'));
	const composeOpen = $derived(
		$page.url.searchParams.get('compose') === '1' || pathname === '/compose'
	);
	const draftId = $derived($page.url.searchParams.get('draft'));

	$effect(() => {
		collapsed = localStorage.getItem('quickinbox:zero-sidebar') === '1';
	});

	$effect(() => {
		mobileOpen = false;
		void pathname;
	});

	function setCollapsed(next: boolean) {
		collapsed = next;
		localStorage.setItem('quickinbox:zero-sidebar', next ? '1' : '0');
	}

	function isNarrow(): boolean {
		return window.matchMedia('(max-width: 767px)').matches;
	}

	function toggleSidebar() {
		if (isNarrow()) {
			mobileOpen = !mobileOpen;
			return;
		}
		if (settings) return;
		setCollapsed(!collapsed);
	}

	type NavItem = { href: string; icon: string; label: string; badge?: number; shortcut?: string };

	const mailNav = $derived<{ title: string; items: NavItem[] }[]>([
		{
			title: t('nav.core'),
			items: [
				{
					href: '/inbox',
					icon: 'Inbox',
					label: t('nav.inbox'),
					badge: data.counts.inbox_unread || undefined,
					shortcut: 'g i'
				},
				{
					href: '/drafts',
					icon: 'Folder',
					label: t('nav.drafts'),
					badge: data.counts.drafts || undefined,
					shortcut: 'g d'
				},
				{ href: '/sent', icon: 'Plane2', label: t('nav.sent'), shortcut: 'g t' }
			]
		},
		{
			title: t('nav.management'),
			items: [
				{
					href: '/archive',
					icon: 'Archive',
					label: t('nav.archive'),
					badge: data.counts.archive || undefined,
					shortcut: 'g a'
				},
				{ href: '/trash', icon: 'Bin', label: t('nav.bin'), badge: data.counts.trash || undefined, shortcut: 'g b' }
			]
		}
	]);

	const settingsNav = $derived<NavItem[]>([
		{ href: '/inbox', icon: 'ArrowLeft', label: t('common.back') },
		{ href: '/settings/general', icon: 'SettingsGear', label: t('nav.general'), shortcut: 'g s' },
		{ href: '/settings/appearance', icon: 'Stars', label: t('nav.appearance') },
		{ href: '/settings/connections', icon: 'Users', label: t('nav.connections') },
		{ href: '/settings/notifications', icon: 'Bell', label: t('nav.notifications') },
		{ href: '/settings/shortcuts', icon: 'Tabs', label: t('nav.shortcuts'), shortcut: '?' },
		...(data.user.is_admin ? [{ href: '/admin', icon: 'SettingsGear', label: t('nav.admin') }] : [])
	]);

	function isActive(href: string): boolean {
		if (href === '/inbox') {
			return pathname === '/inbox' && $page.url.searchParams.get('view') !== 'archive';
		}
		return pathname === href || pathname.startsWith(`${href}/`);
	}

	function openCompose() {
		const url = new URL($page.url);
		if (pathname === '/compose') return;
		url.searchParams.set('compose', '1');
		url.searchParams.delete('draft');
		void goto(`${url.pathname}?${url.searchParams.toString()}`, {
			replaceState: false,
			keepFocus: true,
			noScroll: true
		});
	}

	function closeCompose() {
		if (pathname === '/compose') {
			void goto('/inbox');
			return;
		}
		const url = new URL($page.url);
		url.searchParams.delete('compose');
		url.searchParams.delete('draft');
		void goto(`${url.pathname}${url.search ? `?${url.searchParams}` : ''}`, {
			replaceState: true,
			noScroll: true
		});
	}

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

	function onToggleSidebar() {
		toggleSidebar();
	}

	function onComposeEvent() {
		openCompose();
	}

	$effect(() => {
		window.addEventListener('zero:toggle-sidebar', onToggleSidebar);
		window.addEventListener('zero:compose', onComposeEvent);
		return () => {
			window.removeEventListener('zero:toggle-sidebar', onToggleSidebar);
			window.removeEventListener('zero:compose', onComposeEvent);
		};
	});

	function onKey(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing =
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable);

		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			paletteOpen = !paletteOpen;
			return;
		}

		if (typing) {
			if (event.key === 'Escape' && composeOpen) {
				event.preventDefault();
				closeCompose();
			}
			return;
		}

		if (event.key === 'Escape') {
			if (paletteOpen) paletteOpen = false;
			else if (shortcutsOpen) shortcutsOpen = false;
			else if (composeOpen) closeCompose();
			else if (mobileOpen) mobileOpen = false;
			return;
		}

		if (event.key === 'c' && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			openCompose();
			return;
		}

		if (event.key === '?' || (event.shiftKey && event.key === '/')) {
			event.preventDefault();
			shortcutsOpen = !shortcutsOpen;
			return;
		}

		if (chord === 'g') {
			const map: Record<string, string> = {
				i: '/inbox',
				d: '/drafts',
				t: '/sent',
				a: '/archive',
				b: '/trash',
				s: '/settings/general'
			};
			const href = map[event.key.toLowerCase()];
			chord = '';
			if (href) {
				event.preventDefault();
				void goto(href);
			}
			return;
		}

		if (event.key.toLowerCase() === 'g') {
			chord = 'g';
			window.setTimeout(() => {
				if (chord === 'g') chord = '';
			}, 800);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="z-root"
	class:settings
	data-collapsed={settings || !collapsed ? 'false' : 'true'}
	data-mobile-open={mobileOpen ? 'true' : 'false'}
>
	{#if mobileOpen}
		<button type="button" class="z-mobile-scrim" aria-label={t('nav.closeSidebar')} onclick={() => (mobileOpen = false)}
		></button>
	{/if}

	<aside class="z-sidebar">
		<AccountHeader {data} collapsed={settings || mobileOpen ? false : collapsed} onLogout={logout} />

		{#if !settings}
			<Tooltip text={t('nav.compose')} shortcut="C" side="right" enabled={collapsed && !mobileOpen} stretch>
				<button type="button" class="z-compose" aria-label={t('nav.compose')} onclick={openCompose}>
					{#if collapsed && !mobileOpen}
						<Icon name="PencilCompose" size={14} />
					{:else}
						<span class="z-compose-label">
							<Icon name="PencilCompose" size={14} />
							{t('nav.compose')}
						</span>
					{/if}
				</button>
			</Tooltip>
		{/if}

		<nav class="z-nav">
			{#if settings}
				{#each settingsNav as item (item.href)}
					<a href={item.href} class="z-nav-link" class:active={isActive(item.href)}>
						<Icon name={item.icon} size={16} />
						<span>{item.label}</span>
					</a>
				{/each}
			{:else}
				{#each mailNav as section (section.title)}
					<div class="z-nav-section">
						{#if !collapsed || mobileOpen}<div class="z-nav-title">{section.title}</div>{/if}
						{#each section.items as item (item.href)}
							<Tooltip
								text={item.label}
								shortcut={item.shortcut}
								side="right"
								enabled={collapsed && !mobileOpen}
								stretch
							>
								<a
									href={item.href}
									class="z-nav-link"
									class:active={isActive(item.href)}
									aria-label={collapsed && !mobileOpen ? item.label : undefined}
								>
									<Icon name={item.icon} size={16} />
									{#if !collapsed || mobileOpen}
										<span>{item.label}</span>
										{#if item.badge}<span class="z-nav-badge">{item.badge}</span>{/if}
									{/if}
								</a>
							</Tooltip>
						{/each}
					</div>
				{/each}
			{/if}
		</nav>

		<div class="z-sidebar-foot">
			{#if !settings}
				<Tooltip text={t('nav.settings')} side="right" enabled={collapsed && !mobileOpen} stretch>
					<a
						href="/settings/general"
						class="z-nav-link"
						class:active={isActive('/settings')}
						aria-label={collapsed && !mobileOpen ? t('nav.settings') : undefined}
					>
						<Icon name="SettingsGear" size={16} />
						{#if !collapsed || mobileOpen}<span>{t('nav.settings')}</span>{/if}
					</a>
				</Tooltip>
			{/if}
		</div>
	</aside>

	<div class="z-stage">
		{#if settings}
			<div class="z-settings-panel">
				<div class="z-settings-bar">
					<Tooltip text={t('nav.openSidebar')}>
						<button type="button" class="z-icon-btn z-settings-toggle" aria-label={t('nav.openSidebar')} onclick={toggleSidebar}>
							<Icon name="PanelLeftOpen" size={16} />
						</button>
					</Tooltip>
				</div>
				<div class="z-settings-scroll">
					{@render children()}
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>

	<nav class="z-mobile-nav">
		<Tooltip text={t('nav.inbox')} side="top">
			<a href="/inbox" aria-label={t('nav.inbox')}><Icon name="Inbox" size={18} /></a>
		</Tooltip>
		<Tooltip text={t('nav.compose')} side="top">
			<button type="button" aria-label={t('nav.compose')} onclick={openCompose}><Icon name="PencilCompose" size={16} /></button>
		</Tooltip>
		<Tooltip text={t('nav.sent')} side="top">
			<a href="/sent" aria-label={t('nav.sent')}><Icon name="Plane2" size={18} /></a>
		</Tooltip>
		<Tooltip text={t('nav.settings')} side="top">
			<a href="/settings/general" aria-label={t('nav.settings')}><Icon name="SettingsGear" size={18} /></a>
		</Tooltip>
	</nav>
</div>

{#if composeOpen}
	<ComposeDialog addresses={data.addresses} draftId={draftId} onClose={closeCompose} />
{/if}

{#if paletteOpen}
	<CommandPalette onClose={() => (paletteOpen = false)} />
{/if}

{#if shortcutsOpen}
	<ShortcutsSheet onClose={() => (shortcutsOpen = false)} />
{/if}
