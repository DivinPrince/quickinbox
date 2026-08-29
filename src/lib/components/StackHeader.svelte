<script lang="ts">
	import { goto } from '$app/navigation';
	import { hasInAppHistory } from '$lib/app-chrome';
	import { t } from '$lib/i18n';
	import Icon from './Icon.svelte';

	let {
		title,
		backHref = '/inbox',
		close = false,
		back = true,
		onBack,
		children
	}: {
		title: string;
		backHref?: string;
		/** Use a close (X) control instead of a back arrow. */
		close?: boolean;
		/** Hide the back control on screens that already have tab navigation. */
		back?: boolean;
		onBack?: () => void | Promise<void>;
		children?: import('svelte').Snippet;
	} = $props();

	async function goBack() {
		if (onBack) {
			await onBack();
			return;
		}
		if (hasInAppHistory()) {
			history.back();
			return;
		}
		await goto(backHref);
	}
</script>

<header class="stack-header" class:no-back={!back}>
	{#if back}
		<button type="button" class="stack-back" aria-label={close ? t('common.close') : t('common.back')} onclick={goBack}>
			<Icon name={close ? 'close-line' : 'arrow-left-line'} size={22} />
		</button>
	{/if}
	<h1>{title}</h1>
	<div class="stack-actions">
		{#if children}
			{@render children()}
		{/if}
	</div>
</header>

<style>
	.stack-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.stack-header h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stack-back {
		display: none;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		margin-left: -0.5rem;
		border-radius: 0.75rem;
		color: var(--color-text);
	}

	.stack-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	@media (max-width: 900px) {
		.stack-header {
			position: sticky;
			top: 0;
			z-index: 20;
			min-height: calc(3.25rem + env(safe-area-inset-top));
			margin: 0 -1rem 0;
			padding: env(safe-area-inset-top) 0.5rem 0;
			background: var(--color-surface);
			box-shadow: inset 0 -1px 0 var(--color-line);
		}

		.stack-header h1 {
			font-size: 1.0625rem;
			text-align: center;
		}

		.stack-back {
			display: flex;
		}

		.stack-header.no-back {
			padding-left: 1rem;
		}

		.stack-header.no-back h1 {
			text-align: left;
		}

		.stack-actions {
			min-width: 2.75rem;
			justify-content: flex-end;
		}
	}
</style>
