<script lang="ts">
	import Icon from './Icon.svelte';
	import { haptic, isMobileViewport } from '$lib/app-chrome';

	type Action = {
		icon: string;
		label: string;
		tone: 'danger' | 'star' | 'good';
	};

	let {
		left,
		right,
		onLeft,
		onRight,
		disabled = false,
		children
	}: {
		left?: Action;
		right?: Action;
		onLeft?: () => void;
		onRight?: () => void;
		disabled?: boolean;
		children: import('svelte').Snippet;
	} = $props();

	const THRESHOLD = 72;
	const MAX = 108;

	let offset = $state(0);
	let dragging = $state(false);
	let suppressClick = $state(false);
	let axis: 'undecided' | 'x' | 'y' = 'undecided';
	let startX = 0;
	let startY = 0;
	let rowEl: HTMLDivElement | undefined;

	function clamp(value: number): number {
		const min = right ? -MAX : 0;
		const max = left ? MAX : 0;
		return Math.min(max, Math.max(min, value));
	}

	function onPointerDown(event: PointerEvent) {
		if (disabled || event.button !== 0 || !isMobileViewport()) return;
		dragging = true;
		suppressClick = false;
		axis = 'undecided';
		startX = event.clientX;
		startY = event.clientY;
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (axis === 'undecided') {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
			if (axis === 'x') {
				rowEl?.setPointerCapture(event.pointerId);
				suppressClick = true;
			}
		}

		if (axis !== 'x') return;
		event.preventDefault();
		offset = clamp(dx);
	}

	function finish(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (axis === 'x') {
			if (rowEl?.hasPointerCapture(event.pointerId)) {
				rowEl.releasePointerCapture(event.pointerId);
			}
			if (offset <= -THRESHOLD && right) {
				haptic(12);
				offset = 0;
				onRight?.();
				return;
			}
			if (offset >= THRESHOLD && left) {
				haptic(12);
				offset = 0;
				onLeft?.();
				return;
			}
		}
		offset = 0;
	}

	function onClickCapture(event: MouseEvent) {
		if (!suppressClick) return;
		event.preventDefault();
		event.stopPropagation();
		suppressClick = false;
	}
</script>

<div
	bind:this={rowEl}
	class="swipe-row"
	class:disabled
	class:dragging
	role="group"
	style:--swipe-x="{offset}px"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={finish}
	onpointercancel={finish}
	onclickcapture={onClickCapture}
>
	{#if left}
		<div class="lane lane-left lane-{left.tone}" class:armed={offset >= THRESHOLD}>
			<Icon name={left.icon} size={20} />
			<span>{left.label}</span>
		</div>
	{/if}
	{#if right}
		<div class="lane lane-right lane-{right.tone}" class:armed={offset <= -THRESHOLD}>
			<Icon name={right.icon} size={20} />
			<span>{right.label}</span>
		</div>
	{/if}
	<div class="swipe-content">
		{@render children()}
	</div>
</div>

<style>
	.swipe-row {
		position: relative;
		overflow: hidden;
		touch-action: pan-y;
	}

	.swipe-row.disabled {
		touch-action: auto;
	}

	.swipe-row.dragging .swipe-content {
		transition: none;
	}

	.lane {
		position: absolute;
		inset: 0 auto 0 0;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 50%;
		padding: 0 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #fff;
	}

	.lane-left {
		justify-content: flex-start;
	}

	.lane-right {
		left: auto;
		right: 0;
		justify-content: flex-end;
	}

	.lane-danger {
		background: #b91c1c;
	}

	.lane-star {
		background: #ca8a04;
	}

	.lane-good {
		background: #15803d;
	}

	.lane.armed {
		filter: brightness(1.08);
	}

	.swipe-content {
		position: relative;
		z-index: 1;
		background: var(--color-bg);
		transform: translateX(var(--swipe-x, 0px));
		transition: transform 0.18s ease;
	}

	@media (min-width: 901px) {
		.swipe-row {
			touch-action: auto;
		}

		.lane {
			display: none;
		}

		.swipe-content {
			transform: none;
		}
	}
</style>
