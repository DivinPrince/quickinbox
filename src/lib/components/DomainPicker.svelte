<script lang="ts">
	import Icon from './Icon.svelte';
	import type { AvailableDomain } from '$lib/types';

	let {
		domains,
		selected = $bindable([]),
		multi = true
	}: {
		domains: AvailableDomain[];
		selected: string[];
		/** Single-select for first-run, multi-select when adding more later. */
		multi?: boolean;
	} = $props();

	function toggle(id: string) {
		if (!multi) {
			selected = selected.includes(id) ? [] : [id];
			return;
		}
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}
</script>

<ul class="domain-list">
	{#each domains as domain (domain.id)}
		<li>
			<button
				type="button"
				class="domain-card"
				class:selected={selected.includes(domain.id)}
				aria-pressed={selected.includes(domain.id)}
				onclick={() => toggle(domain.id)}
			>
				<span class="domain-check" class:round={!multi}>
					{#if selected.includes(domain.id)}
						<Icon name="check-line" size={14} />
					{/if}
				</span>

				<span class="domain-main">
					<span class="domain-name">{domain.name}</span>
					<span class="domain-meta">
						<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
						{#if domain.region}<span class="chip">{domain.region}</span>{/if}
					</span>
				</span>

				<span class="domain-caps">
					<span class="cap" class:cap-on={domain.can_send}>
						<Icon name="send-plane-line" size={13} /> Send
					</span>
					<span class="cap" class:cap-on={domain.can_receive}>
						<Icon name="inbox-line" size={13} /> Receive
					</span>
				</span>
			</button>
		</li>
	{/each}
</ul>

{#if selected.some((id) => domains.find((d) => d.id === id && !d.can_receive))}
	<p class="hint">
		<Icon name="information-line" size={14} />
		Receiving is off for a selected domain. Enable inbound on it at the mail provider to get
		mail — sending still works.
	</p>
{/if}

<style>
	.domain-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.domain-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		width: 100%;
		padding: 0.875rem 1rem;
		text-align: left;
		background: var(--color-surface);
		border-radius: 0.875rem;
		box-shadow: var(--shadow-sm);
		transition: box-shadow 0.15s;
	}

	.domain-card:hover {
		box-shadow: var(--shadow-md);
	}

	.domain-card.selected {
		box-shadow: 0 0 0 2px var(--color-accent), var(--shadow-sm);
	}

	.domain-check {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 0.375rem;
		color: var(--color-on-accent);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.domain-check.round {
		border-radius: 9999px;
	}

	.domain-card.selected .domain-check {
		background: var(--color-accent);
		box-shadow: none;
	}

	.domain-main {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		flex: 1;
	}

	.domain-name {
		font-size: 0.9375rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.domain-meta {
		display: flex;
		gap: 0.375rem;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.chip-ok {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.domain-caps {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.cap {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-muted);
	}

	.cap-on {
		color: var(--color-text-secondary);
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.875rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}
</style>
