<script lang="ts">
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n';
	import type { Domain } from '$lib/types';

	let {
		domains,
		activeDomainId,
		block = false
	}: {
		domains: Domain[];
		activeDomainId: string | null;
		/** Stretch to the container width — used inside the sidebar. */
		block?: boolean;
	} = $props();

	let open = $state(false);
	let switching = $state(false);

	const active = $derived(domains.find((domain) => domain.id === activeDomainId) ?? null);
	const label = $derived(active?.name ?? t('domains.all'));

	async function select(domainId: string | null) {
		if (domainId === activeDomainId) {
			open = false;
			return;
		}

		switching = true;
		try {
			await fetch('/api/domains/select', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId })
			});
			window.location.reload();
		} finally {
			switching = false;
			open = false;
		}
	}
</script>

<!-- Only worth showing once more than one domain is connected. -->
{#if domains.length > 1}
	<div class="switcher" class:block>
		<button
			type="button"
			class="switcher-trigger"
			aria-haspopup="listbox"
			aria-expanded={open}
			disabled={switching}
			onclick={() => (open = !open)}
		>
			<Icon name="global-line" size={14} />
			<span class="switcher-label">{label}</span>
			<Icon name={open ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={14} />
		</button>

		{#if open}
			<button
				type="button"
				class="switcher-backdrop"
				aria-label={t('domains.closeMenu')}
				onclick={() => (open = false)}
			></button>
			<ul class="switcher-menu" role="listbox">
				<li>
					<button
						type="button"
						role="option"
						aria-selected={activeDomainId === null}
						class="switcher-item"
						class:selected={activeDomainId === null}
						onclick={() => select(null)}
					>
						<span>{t('domains.all')}</span>
						{#if activeDomainId === null}<Icon name="check-line" size={14} />{/if}
					</button>
				</li>
				{#each domains as domain (domain.id)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={activeDomainId === domain.id}
							class="switcher-item"
							class:selected={activeDomainId === domain.id}
							onclick={() => select(domain.id)}
						>
							<span class="item-name">{domain.name}</span>
							{#if activeDomainId === domain.id}
								<Icon name="check-line" size={14} />
							{:else if !domain.receiving_enabled}
								<span class="item-flag" title={t('domains.receivingOff')}>{t('domains.sendOnly')}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else if domains.length === 1}
	<span class="single-domain" title={domains[0].name}>{domains[0].name}</span>
{/if}

<style>
	.switcher {
		position: relative;
	}

	.switcher.block,
	.switcher.block .switcher-trigger {
		width: 100%;
	}

	.switcher.block .switcher-label {
		flex: 1;
		max-width: none;
		text-align: left;
	}

	.switcher-trigger {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		transition: background 0.15s, color 0.15s;
	}

	.switcher-trigger:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.switcher-trigger:disabled {
		opacity: 0.6;
	}

	.switcher-label {
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.switcher-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
	}

	.switcher-menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		left: 0;
		z-index: 30;
		min-width: 13rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 0.75rem;
		box-shadow: var(--shadow-md);
	}

	.switcher-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
		transition: background 0.12s, color 0.12s;
	}

	.switcher-item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.switcher-item.selected {
		color: var(--color-text);
		font-weight: 500;
	}

	.item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-flag {
		flex-shrink: 0;
		font-size: 0.625rem;
		color: var(--color-muted);
	}

	.single-domain {
		max-width: 10rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	@media (max-width: 900px) {
		.switcher-trigger {
			min-height: var(--touch-target);
			padding: 0.625rem 0.75rem;
			font-size: 0.875rem;
		}

		.switcher-item {
			min-height: var(--touch-target);
			padding: 0.75rem;
			font-size: 0.875rem;
		}
	}
</style>
