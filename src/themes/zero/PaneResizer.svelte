<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	let { paneId, storageKey, label, min, max, remaining, orientation = 'vertical' }: {
		paneId: string;
		storageKey: string;
		label: string;
		/** Size limits in rem, including space reserved for the following pane. */
		min: number;
		max: number;
		remaining: number;
		orientation?: 'vertical' | 'horizontal';
	} = $props();
	const horizontal = $derived(orientation === 'horizontal');
	const sizeProperty = $derived(horizontal ? '--z-pane-height' : '--z-pane-width');

	let handle: HTMLDivElement;
	let pane: HTMLElement | null = null;
	let size = $state(0);
	let minimum = $state(0);
	let maximum = $state(0);
	let dragging = $state(false);
	let pointerId: number | null = null;
	let startPosition = 0;
	let startSize = 0;

	function measure() {
		if (!pane || !handle.parentElement || !handle.getClientRects().length) return;
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
		const available = horizontal ? handle.parentElement.clientHeight : handle.parentElement.clientWidth;
		const handleSize = horizontal ? handle.offsetHeight : handle.offsetWidth;
		minimum = Math.round(min * rem);
		maximum = Math.max(minimum, Math.floor(Math.min(
			max * rem,
			available - remaining * rem - handleSize
		)));
		const bounds = pane.getBoundingClientRect();
		size = Math.round(horizontal ? bounds.height : bounds.width);
	}

	function setSize(next: number) {
		if (!pane) return;
		size = Math.min(maximum, Math.max(minimum, Math.round(next)));
		pane.style.setProperty(sizeProperty, `${size}px`);
	}

	function save() {
		try {
			const value = pane?.style.getPropertyValue(sizeProperty);
			if (value) localStorage.setItem(storageKey, String(parseFloat(value)));
			else localStorage.removeItem(storageKey);
		} catch { /* Resizing still works when browser storage is unavailable. */ }
	}

	function finish() {
		if (!dragging) return;
		dragging = false;
		if (pointerId !== null && handle.hasPointerCapture(pointerId)) {
			handle.releasePointerCapture(pointerId);
		}
		pointerId = null;
		save();
	}

	function start(event: PointerEvent) {
		if (event.button !== 0 || !event.isPrimary || !pane) return;
		event.preventDefault();
		measure();
		startPosition = horizontal ? event.clientY : event.clientX;
		startSize = size;
		pointerId = event.pointerId;
		dragging = true;
		handle.focus();
		handle.setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (dragging && event.pointerId === pointerId) {
			setSize(startSize + (horizontal ? event.clientY : event.clientX) - startPosition);
		}
	}

	function reset() {
		pane?.style.removeProperty(sizeProperty);
		measure();
		save();
	}

	function onKey(event: KeyboardEvent) {
		const decrease = horizontal ? 'ArrowUp' : 'ArrowLeft';
		const increase = horizontal ? 'ArrowDown' : 'ArrowRight';
		if (![decrease, increase, 'Home', 'End', 'Enter'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		measure();
		if (event.key === 'Enter') return reset();
		const step = event.shiftKey ? 32 : 8;
		setSize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum :
			size + (event.key === decrease ? -step : step));
		save();
	}

	onMount(() => {
		pane = document.getElementById(paneId);
		if (!pane) return;
		try {
			const saved = Number(localStorage.getItem(storageKey));
			if (Number.isFinite(saved) && saved > 0) {
				pane.style.setProperty(sizeProperty, `${saved}px`);
			}
		} catch { /* Use the default size when browser storage is unavailable. */ }
		const observer = new ResizeObserver(measure);
		observer.observe(pane);
		observer.observe(handle);
		if (handle.parentElement) observer.observe(handle.parentElement);
		measure();
		return () => {
			finish();
			observer.disconnect();
		};
	});
</script>

<svelte:window onblur={finish} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Resizable window splitters use a focusable separator with arrow-key controls.) -->
<div
	bind:this={handle}
	class="z-pane-resizer"
	class:dragging
	role="separator"
	tabindex="0"
	aria-label={label}
	aria-orientation={orientation}
	aria-controls={paneId}
	aria-valuemin={minimum}
	aria-valuemax={maximum}
	aria-valuenow={size}
	aria-valuetext={t('panes.size', { size })}
	title={`${label}. ${t('panes.resizeHint')}`}
	onpointerdown={start}
	onpointermove={move}
	onpointerup={finish}
	onpointercancel={finish}
	onlostpointercapture={finish}
	ondblclick={reset}
	onkeydown={onKey}
>
	<span aria-hidden="true"></span>
</div>

{#if dragging}
	<div class="z-resize-shield" class:horizontal aria-hidden="true"></div>
{/if}
