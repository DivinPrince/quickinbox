<script lang="ts">
	import { page } from '$app/stores';
	import { LOCALE_OPTIONS, switchLocale, t, type Locale } from '$lib/i18n';

	const current = $derived((($page.data.locale as string | undefined) ?? 'en') as Locale);
	let busy = $state(false);

	async function choose(id: Locale) {
		if (id === current || busy) return;
		busy = true;
		try {
			await switchLocale(id);
		} finally {
			busy = false;
		}
	}
</script>

<div class="locale-options" role="radiogroup" aria-label={t('settings.language')}>
	{#each LOCALE_OPTIONS as option (option.id)}
		<button
			type="button"
			role="radio"
			aria-checked={current === option.id}
			class="locale-option"
			class:selected={current === option.id}
			disabled={busy}
			onclick={() => choose(option.id)}
		>
			<span class="locale-name">{option.nativeName}</span>
			<span class="locale-hint">{option.name}</span>
		</button>
	{/each}
</div>

<style>
	.locale-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.locale-option {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.85rem 1rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-line, var(--z-border, #e5e5e5));
		background: var(--color-surface, var(--z-panel, #fff));
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.locale-option.selected {
		border-color: var(--color-accent, var(--z-primary, #90ac9a));
		box-shadow: inset 0 0 0 1px var(--color-accent, var(--z-primary, #90ac9a));
	}

	.locale-name {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.locale-hint {
		font-size: 0.75rem;
		color: var(--color-muted, var(--z-muted, #8c8c8c));
	}
</style>
