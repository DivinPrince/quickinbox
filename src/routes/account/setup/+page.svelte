<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state(untrack(() => data.user?.name ?? ''));
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let loading = $state(false);

	function setupErrorMessage(code: unknown): string {
		switch (code) {
			case 'name_required':
				return t('accountSetup.nameRequired');
			case 'name_too_long':
				return t('accountSetup.nameTooLong');
			case 'password_too_short':
				return t('accountSetup.passwordTooShort');
			case 'password_too_long':
				return t('accountSetup.passwordTooLong');
			case 'password_mismatch':
				return t('accountSetup.passwordMismatch');
			case 'password_reused':
				return t('accountSetup.passwordReused');
			case 'already_complete':
				return t('accountSetup.alreadyComplete');
			case 'invalid_request':
			case 'unauthorized':
			case 'database_unavailable':
			case 'unknown':
			default:
				return t('accountSetup.failed');
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (password !== confirmPassword) {
			error = t('accountSetup.passwordMismatch');
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/complete-setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, password, confirmPassword })
			});
			const body = await res.json();
			if (!res.ok) {
				error = setupErrorMessage(body.code);
				return;
			}
			window.location.href = '/login?setup=complete';
		} catch {
			error = t('common.networkError');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{t('accountSetup.title', { app: APP_NAME })}</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>{t('accountSetup.heading')}</h1>
			<p>{t('accountSetup.description')}</p>
		</div>

		<form class="mt-8 space-y-4" onsubmit={submit}>
			<div>
				<label for="name" class="text-sm text-[var(--color-text-secondary)]">
					{t('accountSetup.name')}
				</label>
				<input
					id="name"
					type="text"
					bind:value={name}
					required
					autocomplete="name"
					class="auth-input"
				/>
			</div>
			<div>
				<label for="password" class="text-sm text-[var(--color-text-secondary)]">
					{t('accountSetup.newPassword')}
				</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					minlength="8"
					autocomplete="new-password"
					class="auth-input"
				/>
				<p class="field-hint">{t('accountSetup.passwordHint')}</p>
			</div>
			<div>
				<label for="confirm-password" class="text-sm text-[var(--color-text-secondary)]">
					{t('accountSetup.confirmPassword')}
				</label>
				<input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					required
					minlength="8"
					autocomplete="new-password"
					class="auth-input"
				/>
			</div>

			{#if error}
				<p class="text-sm text-[var(--color-text-secondary)]">{error}</p>
			{/if}

			<button type="submit" disabled={loading} class="btn-primary mt-2 w-full py-2.5">
				{loading ? t('accountSetup.saving') : t('accountSetup.continue')}
			</button>
		</form>
	</div>
</div>

<style>
	.auth-brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.auth-brand p {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		border-radius: 0.775rem;
		box-shadow: var(--shadow-sm);
	}

	.field-hint {
		margin-top: 0.375rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-muted);
	}
</style>
