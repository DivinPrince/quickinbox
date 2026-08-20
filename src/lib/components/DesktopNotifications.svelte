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
			loading: 'Checking',
			unsupported: 'Unsupported',
			unconfigured: 'Setup required',
			denied: 'Blocked',
			disabled: 'Off',
			enabled: 'On',
			error: 'Error'
		} satisfies Record<PushState, string>)[pushState]
	);

	function pushErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Could not update desktop notifications';
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
						? 'Notifications are blocked in this browser. Allow them in site settings.'
						: 'Notification permission was not granted.';
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
			<h2><Icon name="notification-3-line" size={18} /> Desktop notifications</h2>
			<p class="section-description">Get an alert when new mail arrives, even after closing this tab.</p>
		</div>
		<span class="badge" class:notification-on={pushState === 'enabled'}>{pushStatusLabel}</span>
	</div>

	{#if pushState === 'unconfigured'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			The server needs VAPID keys before desktop notifications can be enabled.
		</p>
	{:else if pushState === 'unsupported'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			This browser does not support Web Push notifications.
		</p>
	{:else if pushState === 'denied'}
		<p class="hint">
			<Icon name="information-line" size={14} />
			Notifications are blocked. Allow them for this site in your browser settings.
		</p>
	{:else}
		<div class="notification-controls">
			<p class="hint notification-hint">
				{pushState === 'enabled'
					? 'This browser will receive notifications for your account.'
					: 'Permission is requested only when you enable notifications.'}
			</p>
			{#if pushState === 'enabled'}
				<button
					type="button"
					class="btn-ghost"
					disabled={pushBusy}
					onclick={disableDesktopNotifications}
				>
					{pushBusy ? 'Disabling…' : 'Disable'}
				</button>
			{:else}
				<button
					type="button"
					class="btn-primary"
					disabled={pushBusy || pushState === 'loading'}
					onclick={enableDesktopNotifications}
				>
					{pushBusy ? 'Enabling…' : pushState === 'loading' ? 'Checking…' : 'Enable'}
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
