<script lang="ts">
	import Icon from './Icon.svelte';
	import { haptic, isMobileViewport } from '$lib/app-chrome';

	let {
		onRefresh,
		children
	}: {
		onRefresh: () => Promise<void>;
		children: import('svelte').Snippet;
	} = $props();

	const THRESHOLD = 68;
	let pull = $state(0);
	let refreshing = $state(false);
	let armed = $state(false);
	let startY = 0;
	let startX = 0;
	let tracking = false;
	let host: HTMLDivElement | undefined;

	function scrollParent(node: HTMLElement | undefined): HTMLElement | null {
		let current: HTMLElement | null = node ?? null;
		while (current) {
			const { overflowY } = getComputedStyle(current);
			if (overflowY === 'auto' || overflowY === 'scroll') return current;
			current = current.parentElement;
		}
		return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
	}

	$effect(() => {
		const node = host;
		if (!node) return;
		if ('ontouchstart' in window) {
			const start = (event: TouchEvent) => onTouchStart(event);
			const move = (event: TouchEvent) => onTouchMove(event);
			const end = () => void onTouchEnd();
			node.addEventListener('touchstart', start, { passive: true });
			node.addEventListener('touchmove', move, { passive: false });
			node.addEventListener('touchend', end);
			node.addEventListener('touchcancel', end);
			return () => {
				node.removeEventListener('touchstart', start);
				node.removeEventListener('touchmove', move);
				node.removeEventListener('touchend', end);
				node.removeEventListener('touchcancel', end);
			};
		}

		const start = (event: PointerEvent) => onPointerStart(event);
		const move = (event: PointerEvent) => onPointerMove(event);
		const end = () => void onTouchEnd();
		node.addEventListener('pointerdown', start);
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', end);
		node.addEventListener('pointercancel', end);
		return () => {
			node.removeEventListener('pointerdown', start);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', end);
			node.removeEventListener('pointercancel', end);
		};
	});

	function beginTrack(clientX: number, clientY: number): boolean {
		if (refreshing || !isMobileViewport()) return false;
		const scroller = scrollParent(host);
		if (!scroller || scroller.scrollTop > 0) return false;
		tracking = true;
		armed = false;
		startY = clientY;
		startX = clientX;
		return true;
	}

	function moveTrack(clientX: number, clientY: number, event: Event): void {
		if (!tracking || refreshing) return;
		const dy = clientY - startY;
		const dx = clientX - startX;
		if (!armed && (dy < 10 || Math.abs(dx) > dy)) {
			if (dy < 0 || Math.abs(dx) > dy) tracking = false;
			return;
		}
		armed = true;
		pull = Math.max(0, Math.min(120, dy * 0.42));
		if ('cancelable' in event && event.cancelable) event.preventDefault();
	}

	function onTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch) return;
		beginTrack(touch.clientX, touch.clientY);
	}

	function onTouchMove(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch) return;
		moveTrack(touch.clientX, touch.clientY, event);
	}

	function onPointerStart(event: PointerEvent) {
		if (event.button !== 0) return;
		beginTrack(event.clientX, event.clientY);
	}

	function onPointerMove(event: PointerEvent) {
		moveTrack(event.clientX, event.clientY, event);
	}

	async function onTouchEnd() {
		if (!tracking) return;
		tracking = false;
		if (pull >= THRESHOLD) {
			refreshing = true;
			pull = THRESHOLD;
			haptic(10);
			try {
				await onRefresh();
			} finally {
				refreshing = false;
				pull = 0;
				armed = false;
			}
			return;
		}
		pull = 0;
		armed = false;
	}
</script>

<div
	bind:this={host}
	class="ptr"
	class:busy={refreshing}
	style:--ptr="{pull}px"
>
	<div class="ptr-indicator" class:ready={pull >= THRESHOLD || refreshing} aria-hidden="true">
		<Icon name="refresh-line" size={18} />
	</div>
	<div class="ptr-body">
		{@render children()}
	</div>
</div>

<style>
	.ptr {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 100%;
	}

	.ptr-indicator {
		position: absolute;
		top: 0;
		left: 50%;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		margin-left: -1rem;
		border-radius: 9999px;
		color: var(--color-muted);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		opacity: 0;
		transform: translateY(calc(var(--ptr) - 2.25rem)) rotate(calc(var(--ptr) * 2.4deg));
		pointer-events: none;
	}

	.ptr.busy .ptr-indicator,
	.ptr-indicator.ready {
		opacity: 1;
		color: var(--color-text);
	}

	.ptr.busy .ptr-indicator {
		animation: ptr-spin 0.7s linear infinite;
	}

	.ptr-body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 100%;
		transform: translateY(var(--ptr));
	}

	@keyframes ptr-spin {
		to {
			transform: translateY(calc(var(--ptr) - 2.25rem)) rotate(360deg);
		}
	}

	@media (min-width: 901px) {
		.ptr-indicator {
			display: none;
		}

		.ptr-body {
			transform: none;
		}
	}
</style>
