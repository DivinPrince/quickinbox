<script lang="ts">
	import Icon from './Icon.svelte';
	import { isIOS, isStandaloneDisplay } from '$lib/app-chrome';

	type InstallPrompt = Event & { prompt: () => Promise<void> };

	let deferred = $state<InstallPrompt | null>(null);
	let standalone = $state(false);
	let ios = $state(false);
	let busy = $state(false);

	$effect(() => {
		standalone = isStandaloneDisplay();
		ios = isIOS();

		const onPrompt = (event: Event) => {
			event.preventDefault();
			deferred = event as InstallPrompt;
		};
		window.addEventListener('beforeinstallprompt', onPrompt);
		return () => window.removeEventListener('beforeinstallprompt', onPrompt);
	});

	async function install() {
		if (!deferred) return;
		busy = true;
		try {
			await deferred.prompt();
			deferred = null;
		} finally {
			busy = false;
		}
	}
</script>

<section class="surface-lg card">
	<div class="card-head">
		<div>
			<h2><Icon name="smartphone-line" size={18} /> Home screen</h2>
			<p class="section-description">
				{standalone
					? 'Mail is installed on this device.'
					: 'Open Mail like a normal app, without browser chrome.'}
			</p>
		</div>
		<span class="badge" class:on={standalone}>{standalone ? 'Installed' : 'Optional'}</span>
	</div>

	{#if standalone}
		<p class="hint">Notifications and theme still apply while it runs on its own.</p>
	{:else if ios}
		<p class="hint">
			<Icon name="share-forward-line" size={14} />
			Tap Share, then Add to Home Screen.
		</p>
	{:else if deferred}
		<div class="actions">
			<p class="hint flush">Adds Mail to the home screen or app drawer.</p>
			<button type="button" class="btn-primary" disabled={busy} onclick={install}>
				{busy ? 'Installing…' : 'Install'}
			</button>
		</div>
	{:else}
		<p class="hint">
			<Icon name="information-line" size={14} />
			Use the browser menu to install Mail or add it to the home screen.
		</p>
	{/if}
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.section-description {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.badge {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-surface-muted);
	}

	.badge.on {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.flush {
		margin-top: 0;
	}

	@media (max-width: 900px) {
		.card {
			padding: 1.25rem 1rem;
		}

		.actions {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
