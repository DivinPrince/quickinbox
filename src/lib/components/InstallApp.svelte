<script lang="ts">
	import Icon from './Icon.svelte';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import {
		clearInstallPrompt,
		isIOS,
		isStandaloneDisplay,
		subscribeInstallPrompt,
		type InstallPromptEvent
	} from '$lib/app-chrome';

	let deferred = $state<InstallPromptEvent | null>(null);
	let standalone = $state(false);
	let ios = $state(false);
	let busy = $state(false);

	$effect(() => {
		standalone = isStandaloneDisplay();
		ios = isIOS();
		return subscribeInstallPrompt((prompt) => {
			deferred = prompt;
		});
	});

	async function install() {
		if (!deferred) return;
		busy = true;
		try {
			await deferred.prompt();
			clearInstallPrompt();
		} finally {
			busy = false;
		}
	}
</script>

<section class="surface-lg card">
	<div class="card-head">
		<div>
			<h2><Icon name="smartphone-line" size={18} /> {t('install.homeScreen')}</h2>
			<p class="section-description">
				{standalone
					? t('install.installedOnDevice', { app: APP_NAME })
					: t('install.openLikeApp', { app: APP_NAME })}
			</p>
		</div>
		<span class="badge" class:on={standalone}>{standalone ? t('install.installed') : t('install.optional')}</span>
	</div>

	{#if standalone}
		<p class="hint">{t('install.stillApply')}</p>
	{:else if ios}
		<p class="hint">
			<Icon name="share-forward-line" size={14} />
			{t('install.iosHint')}
		</p>
	{:else if deferred}
		<div class="actions">
			<p class="hint flush">{t('install.addsToHome', { app: APP_NAME })}</p>
			<button type="button" class="btn-primary" disabled={busy} onclick={install}>
				{busy ? t('install.installing') : t('install.install')}
			</button>
		</div>
	{:else}
		<p class="hint">
			<Icon name="information-line" size={14} />
			{t('install.browserMenu', { app: APP_NAME })}
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
