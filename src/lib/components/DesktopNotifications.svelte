<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import {
		deletePushSubscription,
		getPushSubscription,
		isPushSubscriptionRegistered,
		savePushSubscription,
		subscribeToPush,
		subscriptionUsesPublicKey,
		supportsWebPush
	} from '$lib/push-client';
	import { t } from '$lib/i18n';

	let {
		configured,
		publicKey
	}: {
		configured: boolean;
		publicKey: string | null;
	} = $props();

	type PushState =
		| 'loading'
		| 'unsupported'
		| 'unconfigured'
		| 'denied'
		| 'disabled'
		| 'enabled'
		| 'error';

	let pushState = $state<PushState>('loading');
	let pushBusy = $state(false);
	let pushError = $state('');
	const pushStatusLabel = $derived(
		({
			loading: t('notifications.checking'),
			unsupported: t('notifications.unsupported'),
			unconfigured: t('notifications.setupRequired'),
			denied: t('notifications.blocked'),
			disabled: t('notifications.off'),
			enabled: t('notifications.on'),
			error: t('notifications.error')
		} satisfies Record<PushState, string>)[pushState]
	);

	function pushErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : t('notifications.updateFailed');
	}

	async function refreshPushState() {
		pushError = '';
		if (!configured || !publicKey) {
			pushState = 'unconfigured';
			return;
		}
		if (!supportsWebPush()) {
			pushState = 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') {
			pushState = 'denied';
			return;
		}

		try {
			const subscription = await getPushSubscription();
			if (
				subscription &&
				Notification.permission === 'granted' &&
				subscriptionUsesPublicKey(subscription, publicKey) &&
				(await isPushSubscriptionRegistered(subscription))
			) {
				pushState = 'enabled';
			} else {
				pushState = 'disabled';
			}
		} catch (error) {
			pushState = 'error';
			pushError = pushErrorMessage(error);
		}
	}

	$effect(() => {
		void refreshPushState();
	});

	async function enableDesktopNotifications() {
		if (!publicKey || !supportsWebPush()) return;
		pushBusy = true;
		pushError = '';
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				pushState = permission === 'denied' ? 'denied' : 'disabled';
				pushError =
					permission === 'denied'
						? t('notifications.blockedHint')
						: t('notifications.notGranted');
				return;
			}

			const subscription = await subscribeToPush(publicKey);
			await savePushSubscription(subscription);
			pushState = 'enabled';
		} catch (error) {
			pushState = 'error';
			pushError = pushErrorMessage(error);
		} finally {
			pushBusy = false;
		}
	}

	async function disableDesktopNotifications() {
		pushBusy = true;
		pushError = '';
		try {
			const subscription = await getPushSubscription();
			if (subscription) {
				await deletePushSubscription(subscription);
				const removed = await subscription.unsubscribe();
				if (!removed) throw new Error('The browser could not remove its push subscription');
			}
			pushState = 'disabled';
		} catch (error) {
			pushState = 'error';
			pushError = pushErrorMessage(error);
		} finally {
			pushBusy = false;
		}
	}
</script>

<section class="surface-lg card">
	<div class="card-head">
		<div>
			<h2><Icon name="notification-3-line" size={18} /> {t('notifications.title')}</h2>
			<p class="section-description">{t('notifications.description')}</p>
		</div>
		<span class="badge" class:notification-on={pushState === 'enabled'}>{pushStatusLabel}</span>
	</div>

	{#if pushState === 'unconfigured'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			{t('notifications.unconfigured')}
		</p>
	{:else if pushState === 'unsupported'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			{t('notifications.unsupportedHint')}
		</p>
	{:else if pushState === 'denied'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			{t('notifications.blockedSite')}
		</p>
	{:else}
		<div class="notification-controls">
			<p class="hint notification-hint">
				{pushState === 'enabled'
					? t('notifications.enabledHint')
					: t('notifications.permissionHint')}
			</p>
			{#if pushState === 'enabled'}
				<button
					type="button"
					class="btn-ghost"
					disabled={pushBusy}
					onclick={disableDesktopNotifications}
				>
					{pushBusy ? t('notifications.disabling') : t('notifications.disable')}
				</button>
			{:else}
				<button
					type="button"
					class="btn-primary"
					disabled={pushBusy || pushState === 'loading'}
					onclick={enableDesktopNotifications}
				>
					{pushBusy ? t('notifications.enabling') : pushState === 'loading' ? t('notifications.checkingAction') : t('notifications.enable')}
				</button>
			{/if}
		</div>
	{/if}

	{#if pushError}<p class="error" aria-live="polite">{pushError}</p>{/if}
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
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-surface-muted);
	}

	.notification-on {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.notification-controls {
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

	.notification-hint {
		margin-top: 0;
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
