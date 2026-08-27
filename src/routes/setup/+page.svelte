<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import WizardShell from '$lib/components/WizardShell.svelte';
	import DomainPicker from '$lib/components/DomainPicker.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import {
		domainPickerSubtitle,
		missingProviderHint,
		missingProviderTitle,
		noDomainsBody,
		noDomainsTitle,
		providerName,
		receivingHint
	} from '$lib/provider-copy';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let step = $state(1);
	let selected = $state<string[]>([]);

	let name = $state('');
	let localPart = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let submitting = $state(false);

	const chosen = $derived(data.available.find((domain) => domain.id === selected[0]) ?? null);
	const cleanLocal = $derived(localPart.trim().toLowerCase().replace(/@.*$/, ''));
	// Once they type a name, offer the obvious mailbox for it.
	const suggestion = $derived(name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '');

	function goToDetails() {
		if (!chosen) {
			error = 'Pick a domain to continue';
			return;
		}
		error = '';
		step = 2;
	}

	async function finish(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (password.length < 8) {
			error = 'Password must be at least 8 characters';
			return;
		}
		if (password !== confirm) {
			error = 'Passwords do not match';
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					domainId: chosen?.id,
					localPart: cleanLocal || suggestion,
					name,
					password
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Setup failed';
				return;
			}
			// The endpoint signs us in, so go straight to the inbox.
			window.location.href = body.signedIn ? '/inbox' : '/login';
		} catch {
			error = 'Network error';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Get started — Mail</title>
</svelte:head>

<WizardShell
	title={step === 1 ? 'Choose your domain' : 'Create your account'}
	subtitle={step === 1
		? domainPickerSubtitle(data.providerKind)
		: `You'll send and receive on ${chosen?.name}.`}
	steps={['Domain', 'Account']}
	current={step}
	partner={step === 1}
	partnerKind={data.providerKind}
	partnerCaption={`Mail + ${providerName(data.providerKind)}`}
>
	{#if step === 1}
		{#if !data.providerConfigured}
			<div class="surface-lg notice notice-warn">
				<Icon name="key-2-line" size={18} />
				<div>
					<p class="notice-title">{missingProviderTitle(data.providerKind)}</p>
					<p class="notice-body">{data.loadError}</p>
					<pre class="snippet">{missingProviderHint(data.providerKind)}</pre>
				</div>
			</div>
		{:else if data.loadError}
			<div class="surface-lg notice notice-warn">
				<Icon name="error-warning-line" size={18} />
				<div>
					<p class="notice-title">Couldn't load your domains</p>
					<p class="notice-body">{data.loadError}</p>
				</div>
			</div>
		{:else if data.available.length === 0}
			<div class="surface-lg notice">
				<Icon name="global-line" size={18} />
				<div>
					<p class="notice-title">{noDomainsTitle(data.providerKind)}</p>
					<p class="notice-body">
						{noDomainsBody(data.providerKind)}
					</p>
				</div>
			</div>
		{:else}
			<DomainPicker domains={data.available} bind:selected multi={false} />

			{#if error}<p class="error">{error}</p>{/if}

			<button type="button" class="btn-primary w-full py-2.5 mt-4" onclick={goToDetails}>
				Continue{chosen ? ` with ${chosen.name}` : ''}
			</button>
		{/if}
	{:else}
		<form class="surface-lg details-card" onsubmit={finish}>
			<label class="field-title" for="name">Your name</label>
			<input
				id="name"
				type="text"
				bind:value={name}
				required
				placeholder="Divin"
				class="text-input"
			/>

			<div class="mt-4">
				<AddressField
					bind:localPart
					domainId={chosen?.id ?? ''}
					domains={chosen ? [chosen] : []}
					placeholder={suggestion || 'you'}
					label="Your address"
				/>
			</div>

			<p class="preview">
				This is your inbox <em>and</em> your login —
				<strong>{(cleanLocal || suggestion || 'you') + '@' + (chosen?.name ?? '')}</strong>
			</p>

			<label class="field-title mt-4" for="password">Password</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				required
				minlength="8"
				autocomplete="new-password"
				class="text-input"
			/>

			<label class="field-title mt-4" for="confirm">Confirm password</label>
			<input
				id="confirm"
				type="password"
				bind:value={confirm}
				required
				minlength="8"
				autocomplete="new-password"
				class="text-input"
			/>

			{#if chosen && !chosen.can_receive}
				<p class="hint">
					<Icon name="information-line" size={14} />
					{receivingHint(data.providerKind, chosen.name)}
				</p>
			{/if}

			{#if error}<p class="error">{error}</p>{/if}

			<div class="actions">
				<button type="button" class="btn-ghost" onclick={() => (step = 1)}>
					<Icon name="arrow-left-line" size={16} /> Back
				</button>
				<button type="submit" class="btn-primary flex-1 py-2.5" disabled={submitting}>
					{submitting ? 'Setting up…' : 'Create account'}
				</button>
			</div>
		</form>
	{/if}
</WizardShell>

<style>
	.details-card {
		padding: 1.5rem;
	}

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.text-input {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.text-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.preview {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	.notice {
		display: flex;
		gap: 0.75rem;
		padding: 1.25rem;
		color: var(--color-text-secondary);
	}

	.notice-warn {
		box-shadow: 0 0 0 1px var(--tone-notice-line), var(--shadow-sm);
	}

	.notice-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.notice-body {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.snippet {
		margin-top: 0.625rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.75rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		overflow-x: auto;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.875rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
