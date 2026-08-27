<script lang="ts">
	import { APP_NAME } from '$lib/constants';
	import type { EmailProviderKind } from '$lib/types';
	import CloudflareMark from './CloudflareMark.svelte';
	import Logo from './Logo.svelte';
	import ResendMark from './ResendMark.svelte';

	let {
		size = 44,
		caption = 'Connected via Cloudflare Email',
		kind = 'cloudflare'
	}: {
		size?: number;
		caption?: string;
		kind?: EmailProviderKind;
	} = $props();
</script>

<div class="partner" aria-label={caption}>
	<div class="partner-marks">
		<span class="mark" title={APP_NAME}>
			<Logo {size} />
		</span>

		<span class="bridge" aria-hidden="true">
			<span class="bridge-line"></span>
			<span class="bridge-dot"></span>
			<span class="bridge-line"></span>
		</span>

		{#if kind === 'cloudflare'}
			<span class="mark" title="Cloudflare">
				<CloudflareMark {size} />
			</span>
		{:else}
			<span class="mark" title="Resend">
				<ResendMark {size} />
			</span>
		{/if}
	</div>
	<p class="partner-caption">{caption}</p>
</div>

<style>
	.partner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1rem;
	}

	.partner-marks {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.mark {
		display: flex;
		border-radius: 0.775rem;
		box-shadow: var(--shadow-sm);
		animation: mark-in 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
	}

	.mark:last-child {
		animation-delay: 120ms;
	}

	.bridge {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		width: 2.75rem;
		animation: bridge-in 640ms cubic-bezier(0.22, 0.61, 0.36, 1) 80ms both;
	}

	.bridge-line {
		flex: 1;
		height: 2px;
		border-radius: 9999px;
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--color-accent) 55%, transparent),
			color-mix(in oklab, var(--color-line) 80%, transparent)
		);
	}

	.bridge-line:last-child {
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--color-line) 80%, transparent),
			color-mix(in oklab, #0a0a0a 45%, transparent)
		);
	}

	.bridge-dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 9999px;
		background: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-accent) 22%, transparent);
		animation: pulse 1.6s ease-in-out infinite;
	}

	.partner-caption {
		font-size: 0.75rem;
		letter-spacing: 0.01em;
		color: var(--color-muted);
		animation: mark-in 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 160ms both;
	}

	@keyframes mark-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes bridge-in {
		from {
			opacity: 0;
			transform: scaleX(0.4);
		}
		to {
			opacity: 1;
			transform: scaleX(1);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.15);
			opacity: 0.85;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mark,
		.bridge,
		.partner-caption,
		.bridge-dot {
			animation: none;
		}
	}
</style>
