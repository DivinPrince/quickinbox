<script lang="ts">
	import type { ThreadLabel } from '$lib/types';

	let { label }: { label: ThreadLabel } = $props();
</script>

<span class="label-chip" style="--label-color: {label.color}">{label.name}</span>

<style>
	.label-chip {
		display: inline-flex;
		align-items: center;
		max-width: 8rem;
		height: 1.125rem;
		padding: 0 0.375rem;
		border-radius: 999px;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		line-height: 1;
		color: var(--label-color);
		background: color-mix(in srgb, var(--label-color) 16%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: middle;
	}
</style>
