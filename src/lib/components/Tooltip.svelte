<script lang="ts">
	import { onDestroy } from 'svelte';

	type Side = 'top' | 'bottom' | 'left' | 'right';

	let {
		text,
		shortcut,
		side = 'bottom',
		enabled = true,
		stretch = false,
		grow = false,
		children
	}: {
		text: string;
		shortcut?: string;
		side?: Side;
		enabled?: boolean;
		stretch?: boolean;
		grow?: boolean;
		children: import('svelte').Snippet;
	} = $props();

	let root = $state<HTMLSpanElement | undefined>();
	let bubble = $state<HTMLDivElement | undefined>();
	let open = $state(false);
	let ready = $state(false);
	let top = $state(0);
	let left = $state(0);
	let showTimer: ReturnType<typeof setTimeout> | undefined;

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function triggerEl(): HTMLElement | undefined {
		return (root?.firstElementChild as HTMLElement | undefined) ?? root;
	}

	function hide() {
		if (showTimer) {
			clearTimeout(showTimer);
			showTimer = undefined;
		}
		open = false;
		ready = false;
	}

	function scheduleShow(event: PointerEvent) {
		if (!enabled || !text.trim()) return;
		if (event.pointerType === 'touch') return;
		if (showTimer) clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			open = true;
		}, 140);
	}

	function onFocus() {
		if (!enabled || !text.trim()) return;
		open = true;
	}

	function coordsFor(preferred: Side, trigger: DOMRect, tip: DOMRect): { top: number; left: number } {
		const gap = 8;
		const centered = trigger.left + trigger.width / 2 - tip.width / 2;
		switch (preferred) {
			case 'bottom':
				return { top: trigger.bottom + gap, left: centered };
			case 'top':
				return { top: trigger.top - tip.height - gap, left: centered };
			case 'left':
				return {
					top: trigger.top + trigger.height / 2 - tip.height / 2,
					left: trigger.left - tip.width - gap
				};
			case 'right':
				return {
					top: trigger.top + trigger.height / 2 - tip.height / 2,
					left: trigger.right + gap
				};
			default: {
				const _exhaustive: never = preferred;
				return _exhaustive;
			}
		}
	}

	function place() {
		const trigger = triggerEl();
		if (!trigger || !bubble) return;
		const tr = trigger.getBoundingClientRect();
		const tip = bubble.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let preferred = side;
		if (preferred === 'bottom' && tr.bottom + 8 + tip.height > vh - 8) preferred = 'top';
		else if (preferred === 'top' && tr.top - 8 - tip.height < 8) preferred = 'bottom';
		else if (preferred === 'right' && tr.right + 8 + tip.width > vw - 8) preferred = 'left';
		else if (preferred === 'left' && tr.left - 8 - tip.width < 8) preferred = 'right';
		const next = coordsFor(preferred, tr, tip);
		left = Math.min(Math.max(8, next.left), vw - tip.width - 8);
		top = Math.min(Math.max(8, next.top), vh - tip.height - 8);
		ready = true;
	}

	$effect(() => {
		if (!open || !bubble) return;
		const frame = requestAnimationFrame(place);
		const onViewport = () => hide();
		window.addEventListener('scroll', onViewport, true);
		window.addEventListener('resize', onViewport);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onViewport, true);
			window.removeEventListener('resize', onViewport);
		};
	});

	function bindHover(node: HTMLElement) {
		function onEnter(event: PointerEvent) {
			scheduleShow(event);
		}
		function onLeave() {
			hide();
		}
		function onDown() {
			hide();
		}
		node.addEventListener('pointerenter', onEnter);
		node.addEventListener('pointerleave', onLeave);
		node.addEventListener('pointerdown', onDown);
		return {
			destroy() {
				node.removeEventListener('pointerenter', onEnter);
				node.removeEventListener('pointerleave', onLeave);
				node.removeEventListener('pointerdown', onDown);
			}
		};
	}

	onDestroy(hide);
</script>

{#if enabled}
	<span
		bind:this={root}
		class="tip-wrap"
		class:stretch
		class:grow
		use:bindHover
		onfocusin={onFocus}
		onfocusout={hide}
	>
		{@render children()}
	</span>
	{#if open}
		<div
			bind:this={bubble}
			class="tip-bubble"
			class:ready
			style:top="{top}px"
			style:left="{left}px"
			role="tooltip"
			use:portal
		>
			<span class="tip-text">{text}</span>
			{#if shortcut}
				<kbd class="tip-kbd">{shortcut}</kbd>
			{/if}
		</div>
	{/if}
{:else}
	{@render children()}
{/if}

<style>
	.tip-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: middle;
		flex-shrink: 0;
	}

	.tip-wrap.stretch {
		display: flex;
		width: 100%;
		flex-shrink: 1;
	}

	.tip-wrap.grow {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-shrink: 1;
	}

	.tip-wrap.grow > :global(*) {
		flex: 1;
		min-width: 0;
		width: 100%;
	}

	.tip-bubble {
		position: fixed;
		z-index: 90;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		width: max-content;
		max-width: min(18rem, calc(100vw - 16px));
		padding: 0.35rem 0.6rem;
		border-radius: 0.5rem;
		border: 1px solid var(--color-line, #e5e5e5);
		background: var(--color-surface, #fff);
		color: var(--color-text, #111);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.3;
		pointer-events: none;
		opacity: 0;
	}

	.tip-bubble.ready {
		opacity: 1;
		transition: opacity 80ms ease;
	}

	.tip-text {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.tip-kbd {
		flex-shrink: 0;
		padding: 0.05rem 0.28rem;
		border-radius: 0.25rem;
		border: 1px solid var(--color-line, #e5e5e5);
		background: color-mix(in srgb, var(--color-text, #111) 6%, transparent);
		color: var(--color-muted, #737373);
		font-family: var(--font-geist-mono, ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 500;
		line-height: 1.2;
	}

	:global([data-ui-theme='zero'][data-theme='dark']) .tip-bubble {
		background: #313131;
		border-color: #404040;
		color: #fafafa;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
	}

	:global([data-ui-theme='zero'][data-theme='dark']) .tip-kbd {
		border-color: #525252;
		color: #a3a3a3;
	}

	@media (prefers-reduced-motion: reduce) {
		.tip-bubble.ready {
			transition: none;
		}
	}
</style>
