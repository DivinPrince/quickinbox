<script lang="ts">
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n';
	import type { DeliveryStatus } from '$lib/types';

	let {
		status,
		detail = null
	}: {
		status: DeliveryStatus | null;
		detail?: string | null;
	} = $props();

	// Resend reports these over the webhook; before that a message is just queued.
	const meta = $derived(
		({
			queued: { label: t('delivery.queued'), icon: 'time-line', tone: 'neutral' },
			sent: { label: t('delivery.sent'), icon: 'check-line', tone: 'neutral' },
			delivered: { label: t('delivery.delivered'), icon: 'check-double-line', tone: 'good' },
			delayed: { label: t('delivery.delayed'), icon: 'time-line', tone: 'warn' },
			bounced: { label: t('delivery.bounced'), icon: 'error-warning-line', tone: 'bad' },
			complained: { label: t('delivery.complained'), icon: 'spam-2-line', tone: 'warn' },
			failed: { label: t('delivery.failed'), icon: 'close-circle-line', tone: 'bad' }
		}) satisfies Record<DeliveryStatus, { label: string; icon: string; tone: string }>
	);

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
