<script lang="ts">
	import { page } from '$app/stores';
	import { switchUiTheme } from '$lib/ui-theme/apply';
	import { BUILTIN_THEME_IDS } from '$lib/ui-theme/ids';

	const OPTIONS: { id: (typeof BUILTIN_THEME_IDS)[number]; name: string; hint: string }[] = [
		{ id: 'zero', name: 'Zero', hint: 'Two-pane inbox' },
		{ id: 'classic', name: 'Classic', hint: 'Stacked mailbox' }
	];

	const current = $derived(($page.data.uiTheme as string | undefined) ?? 'zero');
	let busy = $state(false);

	async function choose(id: (typeof BUILTIN_THEME_IDS)[number]) {
		if (id === current || busy) return;
		busy = true;
		try {
			await switchUiTheme(id);
		} finally {
			busy = false;
		}
	}
</script>

<div class="ui-theme-options" role="radiogroup" aria-label="Interface">
	{#each OPTIONS as option (option.id)}
		<button
			type="button"
			role="radio"
			aria-checked={current === option.id}
			class="ui-theme-option"
			class:selected={current === option.id}
			disabled={busy}
			onclick={() => choose(option.id)}
		>
			<span class="ui-theme-name">{option.name}</span>
			<span class="ui-theme-hint">{option.hint}</span>
		</button>
	{/each}
</div>

<style>
	.ui-theme-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.ui-theme-option {
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

	.ui-theme-option.selected {
		border-color: var(--color-accent, var(--z-primary, #90ac9a));
		box-shadow: inset 0 0 0 1px var(--color-accent, var(--z-primary, #90ac9a));
	}

	.ui-theme-name {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.ui-theme-hint {
		font-size: 0.75rem;
		color: var(--color-muted, var(--z-muted, #8c8c8c));
	}
</style>
