<script lang="ts">
	import Icon from './Icon.svelte';
	import { chooseDesign, getActiveDesignId, listDesigns } from '$lib/designs';
	import type { DesignDefinition } from '$lib/designs';

	const designs = listDesigns();
	let selected = $derived(getActiveDesignId());

	function pick(design: DesignDefinition) {
		chooseDesign(design.id);
	}
</script>

<div class="design-gallery" role="radiogroup" aria-label="Design">
	{#each designs as design (design.id)}
		<button
			type="button"
			role="radio"
			aria-checked={selected === design.id}
			class="design-card"
			class:selected={selected === design.id}
			data-design-preview={design.id}
			onclick={() => pick(design)}
		>
			<span class="design-stage" aria-hidden="true" style:--p-bg={design.preview.background} style:--p-surface={design.preview.surface} style:--p-sidebar={design.preview.sidebar} style:--p-accent={design.preview.accent} style:--p-text={design.preview.text} style:--p-muted={design.preview.muted}>
				<span class="mini-app">
					<span class="mini-rail">
						<span class="mini-mark"></span>
						<span class="mini-compose"></span>
						<span class="mini-nav"></span>
						<span class="mini-nav short"></span>
						<span class="mini-nav"></span>
					</span>
					<span class="mini-pane">
						<span class="mini-search"></span>
						{#if design.mailboxLayout === 'stack'}
							<span class="mini-stack">
								<span class="mini-stack-row">
									<span class="mini-dot"></span>
									<span class="mini-stack-lines">
										<span class="mini-bar"></span>
										<span class="mini-line"></span>
									</span>
								</span>
								<span class="mini-stack-row">
									<span class="mini-dot dim"></span>
									<span class="mini-stack-lines">
										<span class="mini-bar"></span>
										<span class="mini-line"></span>
									</span>
								</span>
							</span>
						{:else}
							<span class="mini-row"></span>
							<span class="mini-row faint"></span>
							<span class="mini-row"></span>
						{/if}
					</span>
				</span>
			</span>

			<span class="design-meta">
				<span class="design-name">{design.label}</span>
				<span class="design-copy">{design.description}</span>
			</span>

			{#if selected === design.id}
				<span class="design-check"><Icon name="check-line" size={14} /></span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.design-gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14.5rem, 1fr));
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.design-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.625rem;
		border-radius: 0.875rem;
		text-align: left;
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: box-shadow 0.15s, background 0.15s;
	}

	.design-card:hover {
		background: var(--color-surface-muted);
	}

	.design-card.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.design-stage {
		display: block;
		height: 7.25rem;
		padding: 0.5rem;
		border-radius: 0.5rem;
		background: var(--p-bg);
		overflow: hidden;
	}

	.mini-app {
		display: flex;
		height: 100%;
		border-radius: 0.375rem;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--p-text) 8%, transparent);
	}

	.mini-rail {
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
		width: 2.35rem;
		padding: 0.4rem 0.3rem;
		background: var(--p-sidebar);
	}

	.mini-mark {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 0.2rem;
		background: var(--p-accent);
	}

	.mini-compose {
		height: 0.55rem;
		border-radius: 0.15rem;
		background: var(--p-accent);
	}

	.mini-nav {
		height: 0.28rem;
		border-radius: 9999px;
		background: var(--p-muted);
		opacity: 0.7;
	}

	.mini-nav.short {
		width: 70%;
	}

	.mini-pane {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.4rem 0.45rem;
		background: var(--p-surface);
	}

	.mini-search {
		height: 0.55rem;
		border-radius: 0.2rem;
		background: color-mix(in srgb, var(--p-muted) 35%, var(--p-surface));
	}

	.mini-row,
	.mini-bar,
	.mini-line {
		height: 0.32rem;
		border-radius: 9999px;
		background: var(--p-text);
		opacity: 0.55;
	}

	.mini-row {
		width: 100%;
	}

	.mini-row.faint {
		width: 78%;
		opacity: 0.28;
	}

	.mini-stack {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.15rem;
	}

	.mini-stack-row {
		display: flex;
		align-items: flex-start;
		gap: 0.3rem;
	}

	.mini-dot {
		width: 0.45rem;
		height: 0.45rem;
		margin-top: 0.05rem;
		border-radius: 9999px;
		background: var(--p-accent);
		flex-shrink: 0;
	}

	.mini-dot.dim {
		background: var(--p-muted);
		opacity: 0.45;
	}

	.mini-stack-lines {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.18rem;
	}

	.mini-bar {
		width: 55%;
		height: 0.28rem;
		opacity: 0.9;
	}

	.mini-line {
		width: 88%;
		height: 0.22rem;
		opacity: 0.35;
	}

	.design-meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0 0.125rem 0.125rem;
	}

	.design-name {
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--color-text);
	}

	.design-copy {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.design-check {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 9999px;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	:global([data-design='zero']) .design-card {
		border-radius: 0.5rem;
	}
</style>
