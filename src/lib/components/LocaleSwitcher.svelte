<script lang="ts">
	import { page } from '$app/stores';
	import {
		LOCALE_OPTIONS,
		localeShortLabel,
		switchLocale,
		t,
		type Locale
	} from '$lib/i18n';
	import Tooltip from './Tooltip.svelte';

	let {
		open = $bindable(false),
		embedded = false,
		onOpen
	}: {
		open?: boolean;
		embedded?: boolean;
		onOpen?: () => void;
	} = $props();

	const current = $derived((($page.data.locale as string | undefined) ?? 'en') as Locale);
	let busy = $state(false);
	let root = $state<HTMLDivElement | undefined>(undefined);

	function toggle() {
		const next = !open;
		if (next) onOpen?.();
		open = next;
	}

	async function choose(id: Locale) {
		if (id === current || busy) return;
		busy = true;
		open = false;
		try {
			await switchLocale(id);
		} finally {
			busy = false;
		}
	}

	function onDocPointer(event: PointerEvent) {
		if (embedded) return;
		const target = event.target as Node | null;
		if (!target || !root?.contains(target)) open = false;
	}
</script>

<svelte:window onpointerdown={onDocPointer} />

{#if embedded}
	<p class="locale-label">{t('settings.language')}</p>
	{#each LOCALE_OPTIONS as option (option.id)}
		<button
			type="button"
			role="option"
			aria-selected={current === option.id}
			disabled={busy}
			onclick={() => choose(option.id)}
		>
			<span>{option.nativeName}</span>
			{#if current === option.id}
				<span class="locale-check" aria-hidden="true">✓</span>
			{/if}
		</button>
	{/each}
{:else}
	<div class="locale-switcher" bind:this={root}>
		<Tooltip text={t('settings.language')}>
			<button
				type="button"
				class="locale-trigger"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={t('settings.language')}
				disabled={busy}
				onclick={toggle}
			>
				{localeShortLabel(current)}
			</button>
		</Tooltip>
		{#if open}
			<div class="locale-menu" role="listbox" aria-label={t('settings.language')}>
				{#each LOCALE_OPTIONS as option (option.id)}
					<button
						type="button"
						role="option"
						aria-selected={current === option.id}
						class:selected={current === option.id}
						disabled={busy}
						onclick={() => choose(option.id)}
					>
						<span class="locale-code">{localeShortLabel(option.id)}</span>
						<span class="locale-name">{option.nativeName}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.locale-switcher {
		position: relative;
		flex-shrink: 0;
	}

	.locale-trigger {
		display: grid;
		place-items: center;
		min-width: 1.75rem;
		height: 1.75rem;
		padding: 0 0.35rem;
		border: none;
		border-radius: 0.4rem;
		background: none;
		color: var(--color-muted, var(--z-muted, #8c8c8c));
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		cursor: pointer;
	}

	.locale-trigger:hover {
		background: var(--color-surface-hover, var(--z-hover, rgba(0, 0, 0, 0.06)));
		color: var(--color-text, var(--z-fg, inherit));
	}

	.locale-menu {
		position: absolute;
		z-index: 50;
		top: calc(100% + 0.35rem);
		right: 0;
		min-width: 11.5rem;
		padding: 0.35rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-line, var(--z-border, #e5e5e5));
		background: var(--color-surface, var(--z-panel, #fff));
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
	}

	.locale-menu button {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0.55rem;
		border: none;
		border-radius: 0.5rem;
		background: none;
		color: inherit;
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
	}

	.locale-menu button:hover,
	.locale-menu button.selected {
		background: var(--color-surface-muted, var(--z-hover, rgba(0, 0, 0, 0.06)));
	}

	.locale-code {
		width: 1.5rem;
		flex-shrink: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--color-muted, var(--z-muted, #8c8c8c));
	}

	.locale-menu button.selected .locale-code {
		color: var(--color-accent, var(--z-primary, #90ac9a));
	}

	.locale-name {
		flex: 1;
		min-width: 0;
	}

	:global([data-ui-theme='zero']) .locale-trigger {
		color: var(--icon-color, var(--z-muted));
	}

	:global([data-ui-theme='zero']) .locale-trigger:hover {
		background: var(--z-hover);
		color: var(--z-fg);
	}

	.locale-label {
		padding: 0.35rem 0.55rem 0.15rem;
		font-size: 11px;
		font-weight: 500;
		color: var(--color-muted, var(--z-muted, #8c8c8c));
	}

	.locale-check {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-accent, var(--z-primary, #90ac9a));
	}
</style>
