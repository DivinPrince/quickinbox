<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		checked = false,
		indeterminate = false,
		disabled = false,
		label,
		caption = '',
		onchange
	}: {
		checked?: boolean;
		indeterminate?: boolean;
		disabled?: boolean;
		label: string;
		caption?: string;
		onchange?: (next: boolean) => void;
	} = $props();

	const icon = $derived(
		indeterminate
			? 'checkbox-indeterminate-line'
			: checked
				? 'checkbox-fill'
				: 'checkbox-blank-line'
	);
</script>

<button
	type="button"
	role="checkbox"
	aria-checked={indeterminate ? 'mixed' : checked}
	aria-label={label}
	class="check"
	class:on={checked && !indeterminate}
	class:mixed={indeterminate}
	class:labeled={Boolean(caption)}
	{disabled}
	onclick={() => onchange?.(!checked)}
>
	<Icon name={icon} size={18} />
	{#if caption}<span>{caption}</span>{/if}
</button>

<style>
	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		color: var(--color-muted);
		background: transparent;
		cursor: pointer;
		transition: color 0.15s;
	}

	.check:hover:not(:disabled) {
		color: var(--color-text);
	}

	.check:focus-visible {
		outline: none;
		border-radius: 0.25rem;
		box-shadow: 0 0 0 3px var(--color-focus-halo);
	}

	.check.on,
	.check.mixed {
		color: var(--color-accent);
	}

	.check:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.check.labeled {
		width: auto;
		height: auto;
		gap: 0.4rem;
		padding: 0.375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.check.labeled:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.check.labeled.on,
	.check.labeled.mixed {
		color: var(--color-text);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.check.labeled.on :global(i),
	.check.labeled.mixed :global(i) {
		color: var(--color-accent);
	}

	.check.labeled:focus-visible {
		box-shadow: inset 0 0 0 1.5px var(--color-accent), 0 0 0 3px var(--color-focus-halo);
	}

	@media (max-width: 900px) {
		.check:not(.labeled) {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
</style>
