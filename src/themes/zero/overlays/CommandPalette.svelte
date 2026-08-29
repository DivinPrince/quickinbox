<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { participantName, viewFromLocation } from '$lib/mail/folders';
	import { t } from '$lib/i18n';
	import type { MailboxPage, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';

	let { onClose }: { onClose: () => void } = $props();

	type NavItem = { kind: 'nav'; href: string; icon: string; label: string };
	type ResultItem = { kind: 'thread'; thread: ThreadSummary; label: string };

	const nav = $derived<NavItem[]>([
		{ kind: 'nav', href: '/inbox?compose=1', icon: 'PencilCompose', label: t('nav.compose') },
		{ kind: 'nav', href: '/inbox', icon: 'Inbox', label: t('nav.inbox') },
		{ kind: 'nav', href: '/drafts', icon: 'Folder', label: t('nav.drafts') },
		{ kind: 'nav', href: '/sent', icon: 'Plane2', label: t('nav.sent') },
		{ kind: 'nav', href: '/archive', icon: 'Archive', label: t('nav.archive') },
		{ kind: 'nav', href: '/trash', icon: 'Bin', label: t('nav.bin') },
		{ kind: 'nav', href: '/starred', icon: 'Star2', label: t('nav.starred') },
		{ kind: 'nav', href: '/settings/general', icon: 'SettingsGear', label: t('nav.settings') }
	]);

	let query = $state('');
	let active = $state(0);
	let results = $state<ThreadSummary[]>([]);
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		inputEl?.focus();
	});

	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			return;
		}
		let cancelled = false;
		const handle = window.setTimeout(() => {
			void fetch(`/api/mail?q=${encodeURIComponent(q)}`)
				.then(async (response) => {
					const body = (await response.json()) as MailboxPage;
					if (!cancelled && body.threads) results = body.threads.slice(0, 8);
				})
				.catch(() => {
					if (!cancelled) results = [];
				});
		}, 180);
		return () => {
			cancelled = true;
			window.clearTimeout(handle);
		};
	});

	const view = $derived(viewFromLocation($page.url.pathname, $page.url.searchParams));

	const items = $derived.by((): (NavItem | ResultItem)[] => {
		const q = query.trim().toLowerCase();
		const filtered = q ? nav.filter((item) => item.label.toLowerCase().includes(q)) : nav;
		const hits: ResultItem[] = results.map((thread) => ({
			kind: 'thread',
			thread,
			label: `${participantName(thread.participants, view, $page.data.locale)} — ${thread.subject || t('mailbox.noSubject')}`
		}));
		return [...filtered, ...hits];
	});

	$effect(() => {
		if (active >= items.length) active = 0;
	});

	function run(item: NavItem | ResultItem) {
		if (item.kind === 'nav') {
			void goto(item.href);
		} else {
			void goto(`/inbox?thread=${encodeURIComponent(item.thread.latest_id)}`);
		}
		onClose();
	}

	function submit() {
		const item = items[active];
		if (item) {
			run(item);
			return;
		}
		const q = query.trim();
		if (q) {
			void goto(`/inbox?q=${encodeURIComponent(q)}`);
			onClose();
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = items.length === 0 ? 0 : (active + 1) % items.length;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = items.length === 0 ? 0 : (active - 1 + items.length) % items.length;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			submit();
		}
	}
</script>

<div
	class="z-palette-scrim"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div class="z-palette" role="dialog" aria-modal="true" aria-label={t('search.title')} tabindex="-1" onkeydown={onKey}>
		<input bind:this={inputEl} bind:value={query} placeholder={t('search.placeholder')} />
		<div class="z-palette-list">
			{#if items.length === 0}
				<div class="z-palette-item" style="cursor: default; opacity: 0.7;">
					{query.trim().length < 2 ? t('search.typeToSearch') : t('search.noMatches')}
				</div>
			{:else}
				{#each items as item, index (item.kind === 'nav' ? item.href : item.thread.thread_id)}
					<button
						type="button"
						class="z-palette-item"
						class:active={index === active}
						onmouseenter={() => (active = index)}
						onclick={() => run(item)}
					>
						{#if item.kind === 'nav'}
							<Icon name={item.icon} />
							<span>{item.label}</span>
						{:else}
							<Icon name="Mail" />
							<span>{item.label}</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>
</div>
