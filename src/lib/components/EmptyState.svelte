<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		icon,
		title
	}: {
		icon: string;
		title: string;
	} = $props();
</script>

<div class="empty-state">
	<div class="empty-icon">
		<Icon name={icon} size={28} />
	</div>
	<p>{title}</p>
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.5rem;
		height: 3.5rem;
		margin-bottom: 1rem;
		border-radius: 1rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		color: var(--color-muted);
	}
</style>
