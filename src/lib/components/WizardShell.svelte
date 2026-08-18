<script lang="ts">
	import type { EmailProviderKind } from '$lib/types';
	import Logo from './Logo.svelte';
	import PartnerLink from './PartnerLink.svelte';

	let {
		title,
		subtitle,
		steps = [],
		current = 1,
		/** Show Mail ↔ provider marks above the title (domain connect screens). */
		partner = false,
		partnerCaption = 'Connected via Cloudflare Email',
		partnerKind = 'cloudflare',
		children
	}: {
		title: string;
		subtitle?: string;
		/** Step labels; omit for a single-screen wizard. */
		steps?: string[];
		current?: number;
		partner?: boolean;
		partnerCaption?: string;
		partnerKind?: EmailProviderKind;
		children: import('svelte').Snippet;
	} = $props();
</script>

<div class="wizard">
	<header class="wizard-head">
		{#if partner}
			<PartnerLink size={44} caption={partnerCaption} kind={partnerKind} />
		{:else}
			<div class="brand-icon"><Logo size={48} /></div>
		{/if}
		<h1>{title}</h1>
		{#if subtitle}
			<p class="subtitle">{subtitle}</p>
		{/if}

		{#if steps.length > 1}
			<ol class="steps" aria-label="Setup progress">
				{#each steps as label, index (label)}
					<li class:active={current === index + 1} class:done={current > index + 1}>
						<span class="step-dot">{current > index + 1 ? '✓' : index + 1}</span>
						{label}
					</li>
				{/each}
			</ol>
		{/if}
	</header>

	{@render children()}
</div>

<style>
	.wizard {
		width: 100%;
		max-width: 32rem;
		margin: 0 auto;
		padding: 3rem 1rem 4rem;
	}

	.wizard-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		margin-bottom: 1.75rem;
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		/* Matches the mark's own corner radius so the shadow hugs the tile. */
		border-radius: 0.775rem;
		box-shadow: var(--shadow-sm);
	}

	.wizard-head h1 {
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.subtitle {
		max-width: 26rem;
		margin-top: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
	}

	.steps {
		display: flex;
		gap: 1.25rem;
		margin-top: 1.5rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.steps li.active,
	.steps li.done {
		color: var(--color-text);
	}

	.step-dot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		background: var(--color-surface-muted);
	}

	.steps li.active .step-dot,
	.steps li.done .step-dot {
		color: var(--color-on-accent);
		background: var(--color-accent);
	}
</style>
