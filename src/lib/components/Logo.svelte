<script lang="ts">
	import { getActiveDesign } from '$lib/designs';
	import type { DesignMark } from '$lib/designs';

	// The app mark follows the active design. New marks must be handled
	// exhaustively here so a catalog addition fails the typecheck.
	let {
		size = 30,
		class: className = ''
	}: {
		size?: number;
		class?: string;
	} = $props();

	const design = $derived(getActiveDesign());

	function markLabel(mark: DesignMark): string {
		switch (mark) {
			case 'mail':
				return 'Mail';
			case 'zero':
				return '0.email';
			default: {
				const _never: never = mark;
				return _never;
			}
		}
	}
</script>

{#if design.mark === 'zero'}
	<svg
		class={className}
		width={size}
		height={size}
		viewBox="0 0 191 191"
		xmlns="http://www.w3.org/2000/svg"
		role="img"
		aria-label={markLabel(design.mark)}
	>
		<!-- Official Mail-0 / 0.email mark -->
		<path
			d="M38.125 190.625V152.5H0V38.125H38.125V0H152.5V38.125H190.625V152.5H152.5V190.625H38.125ZM38.125 114.375H76.25V150.975H152.5V76.25H114.375V114.375H76.25V76.25H114.375V39.65H38.125V114.375Z"
			fill="currentColor"
		/>
	</svg>
{:else}
	<svg
		class={className}
		width={size}
		height={size}
		viewBox="0 0 64 64"
		xmlns="http://www.w3.org/2000/svg"
		role="img"
		aria-label={markLabel(design.mark)}
	>
		<rect width="64" height="64" rx="16.5" fill="#90ac9a" />
		<g
			transform="translate(9.7 9.7) scale(1.858)"
			fill="none"
			stroke="#363636"
			stroke-width="2.3"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
			<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
			<path d="m16 19 2 2 4-4" />
		</g>
	</svg>
{/if}
