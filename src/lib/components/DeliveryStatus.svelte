<script lang="ts">
	import Icon from './Icon.svelte';
	import type { DeliveryStatus } from '$lib/types';

	let {
		status,
		detail = null
	}: {
		status: DeliveryStatus | null;
		detail?: string | null;
	} = $props();

	// Resend reports these over the webhook; before that a message is just queued.
	const meta: Record<DeliveryStatus, { label: string; icon: string; tone: string }> = {
		queued: { label: 'Sending', icon: 'time-line', tone: 'neutral' },
		sent: { label: 'Sent', icon: 'check-line', tone: 'neutral' },
		delivered: { label: 'Delivered', icon: 'check-double-line', tone: 'good' },
		delayed: { label: 'Delayed', icon: 'time-line', tone: 'warn' },
		bounced: { label: 'Bounced', icon: 'error-warning-line', tone: 'bad' },
		complained: { label: 'Marked as spam', icon: 'spam-2-line', tone: 'warn' },
		failed: { label: 'Failed', icon: 'close-circle-line', tone: 'bad' }
	};

	const info = $derived(status ? meta[status] : null);
</script>

{#if info}
	<span class="status status-{info.tone}" title={detail ?? info.label}>
		<Icon name={info.icon} size={12} />
		{info.label}
	</span>
{/if}

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.status-neutral {
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.status-good {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.status-warn {
		color: var(--tone-warn-fg);
		background: var(--tone-warn-bg);
	}

	.status-bad {
		color: var(--tone-bad-fg);
		background: var(--tone-bad-bg);
	}
</style>
