<script lang="ts">
	import { goto } from '$app/navigation';
	import { haptic, hasInAppHistory, isMobileViewport, requestSkipViewTransition } from '$lib/app-chrome';

	let {
		href,
		children
	}: {
		href: string;
		children: import('svelte').Snippet;
	} = $props();

	const EDGE = 28;
	const THRESHOLD = 88;

	let offset = $state(0);
	let dragging = $state(false);
	let startX = 0;
	let startY = 0;
	let axis: 'undecided' | 'x' | 'y' = 'undecided';
	let host: HTMLDivElement | undefined;

	function goBack() {
		requestSkipViewTransition();
		if (hasInAppHistory()) {
			history.back();
			return;
		}
		void goto(href);
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
		);
	}

	function begin(clientX: number, clientY: number, target: EventTarget | null): boolean {
		if (clientX > EDGE || !isMobileViewport() || isTypingTarget(target)) return false;
		dragging = true;
		axis = 'undecided';
		startX = clientX;
		startY = clientY;
		return true;
	}

	function move(clientX: number, clientY: number, event: Event, pointerId?: number): void {
		if (!dragging) return;
		const dx = clientX - startX;
		const dy = clientY - startY;
		if (axis === 'undecided') {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			axis = dx > 0 && dx >= Math.abs(dy) ? 'x' : 'y';
			if (axis === 'y') {
				dragging = false;
				offset = 0;
				return;
			}
		}
		if (axis !== 'x') return;
		if (event.cancelable) event.preventDefault();
		if (pointerId != null && host && !host.hasPointerCapture(pointerId)) {
			host.setPointerCapture(pointerId);
		}
		offset = Math.max(0, Math.min(window.innerWidth, dx));
	}

	function finish() {
		if (!dragging) return;
		const committed = offset;
		dragging = false;
		if (committed >= THRESHOLD) {
			haptic(10);
			offset = window.innerWidth;
			goBack();
			return;
		}
		offset = 0;
		axis = 'undecided';
	}

	function onPointerDown(event: PointerEvent) {
		if ('ontouchstart' in window || event.button !== 0) return;
		begin(event.clientX, event.clientY, event.target);
	}

	function onPointerMove(event: PointerEvent) {
		move(event.clientX, event.clientY, event, event.pointerId);
	}

	$effect(() => {
		const node = host;
		if (!node || !('ontouchstart' in window)) return;
		const start = (event: TouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;
			begin(touch.clientX, touch.clientY, event.target);
		};
		const drag = (event: TouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;
			move(touch.clientX, touch.clientY, event);
		};
		const end = () => finish();
		node.addEventListener('touchstart', start, { passive: true });
		node.addEventListener('touchmove', drag, { passive: false });
		node.addEventListener('touchend', end);
		node.addEventListener('touchcancel', end);
		return () => {
			node.removeEventListener('touchstart', start);
			node.removeEventListener('touchmove', drag);
			node.removeEventListener('touchend', end);
			node.removeEventListener('touchcancel', end);
		};
	});
</script>

<div
	bind:this={host}
	class="swipe-back"
	class:dragging
	role="group"
	style:--back-x="{offset}px"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={finish}
	onpointercancel={finish}
>
	{@render children()}
</div>

<style>
	.swipe-back {
		display: flex;
		flex-direction: column;
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
		height: 100%;
		background: var(--color-surface);
		touch-action: pan-y;
	}

	.swipe-back.dragging {
		transform: translateX(var(--back-x));
		transition: none;
	}

	.swipe-back:not(.dragging) {
		transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1);
	}

	@media (min-width: 901px) {
		/* Phone stacked-screen chrome only. A real box here becomes a centred
		   surface column on desktop and squeezes compose/thread into a phone. */
		.swipe-back {
			display: contents;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.swipe-back.dragging,
		.swipe-back:not(.dragging) {
			transform: none;
			transition: none;
		}
	}
</style>
