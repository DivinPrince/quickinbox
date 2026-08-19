<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import {
		readThemePreference,
		setThemePreference,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme';
	import type { MailAddress } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The preference lives in localStorage, so it can only be read on the client.
	let theme = $state<ThemePreference>('system');
	$effect(() => {
		theme = readThemePreference();
	});

	function chooseTheme(next: ThemePreference) {
		theme = next;
		setThemePreference(next);
	}

	// Server data until an edit happens, then whatever the API returned.
	let edited = $state<MailAddress[] | null>(null);
	const addresses = $derived(edited ?? data.addresses);

	let localPart = $state('');
	let domainId = $state('');
	let error = $state('');
	let busy = $state(false);

	$effect(() => {
		if (!domainId && data.domains[0]) {
			domainId = data.domains[0].id;
		}
	});

	const selectedDomain = $derived(data.domains.find((domain) => domain.id === domainId));

	async function addAddress(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';

		try {
			const res = await fetch('/api/addresses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId, localPart })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not add that address';
				return;
			}
			edited = [...addresses, body.address];
			localPart = '';
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}

	async function makeDefault(id: string) {
		const res = await fetch(`/api/addresses/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isDefault: true })
		});
		const body = await res.json();
		if (res.ok) edited = body.addresses;
	}

	// --- profile picture ----------------------------------------------------

	let avatarBusy = $state(false);
	let avatarError = $state('');
	let avatarSet = $state<boolean | null>(null);
	const hasAvatar = $derived(avatarSet ?? data.user?.hasAvatar ?? false);
	// Same URL before and after a change, so the cached response needs defeating.
	let avatarVersion = $state(0);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function uploadAvatar(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		avatarBusy = true;
		avatarError = '';
		try {
			const form = new FormData();
			form.append('avatar', file);
			const res = await fetch('/api/avatar', { method: 'POST', body: form });
			const body = await res.json();
			if (!res.ok) {
				avatarError = body.error ?? 'Could not upload that image';
				return;
			}
			avatarSet = true;
			avatarVersion += 1;
		} catch {
			avatarError = 'Network error';
		} finally {
			avatarBusy = false;
			input.value = '';
		}
	}

	async function removeAvatar() {
		avatarBusy = true;
		avatarError = '';
		try {
			const res = await fetch('/api/avatar', { method: 'DELETE' });
			if (!res.ok) {
				avatarError = 'Could not remove your picture';
				return;
			}
			avatarSet = false;
			avatarVersion += 1;
		} catch {
			avatarError = 'Network error';
		} finally {
			avatarBusy = false;
		}
	}

	async function remove(id: string) {
		const res = await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			error = body.error ?? 'Could not remove that address';
			return;
		}
		edited = body.addresses;
	}
</script>

<svelte:head>
	<title>Settings — Mail</title>
</svelte:head>

<div class="settings-page">
	<h1>Settings</h1>

	<section class="surface-lg card">
		<h2><Icon name="contrast-2-line" size={18} /> Appearance</h2>
		<p class="card-hint">Choose how Mail looks. System follows your device setting.</p>

		<div class="theme-options" role="radiogroup" aria-label="Theme">
			{#each THEME_OPTIONS as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={theme === option.value}
					class="theme-option"
					class:selected={theme === option.value}
					onclick={() => chooseTheme(option.value)}
				>
					<span class="theme-preview theme-preview-{option.value}">
						<span class="preview-bar"></span>
						<span class="preview-line"></span>
						<span class="preview-line short"></span>
					</span>
					<span class="theme-label">
						<Icon name={option.icon} size={15} />
						{option.label}
					</span>
					{#if theme === option.value}
						<span class="theme-check"><Icon name="check-line" size={14} /></span>
					{/if}
				</button>
			{/each}
		</div>
	</section>

	<section class="surface-lg card">
		<h2><Icon name="user-line" size={18} /> Profile picture</h2>
		<p class="card-hint">Shown next to your messages inside Mail.</p>

		<div class="avatar-row">
			<Avatar
				email={data.user?.email ?? ''}
				name={data.user?.name}
				size={64}
				version={avatarVersion}
			/>

			<div class="avatar-actions">
				<input
					bind:this={fileInput}
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp"
					class="sr-only"
					onchange={uploadAvatar}
				/>
				<button
					type="button"
					class="btn-primary"
					disabled={avatarBusy}
					onclick={() => fileInput?.click()}
				>
					{avatarBusy ? 'Working…' : hasAvatar ? 'Change picture' : 'Upload picture'}
				</button>
				{#if hasAvatar}
					<button type="button" class="btn-ghost" disabled={avatarBusy} onclick={removeAvatar}>
						Remove
					</button>
				{/if}
				<p class="avatar-note">PNG, JPEG, GIF or WebP, up to 1MB.</p>
			</div>
		</div>

		{#if avatarError}<p class="error">{avatarError}</p>{/if}

	</section>

	<section class="surface-lg card">
		<h2><Icon name="at-line" size={18} /> Your addresses</h2>
		<p class="card-hint">
			Mail sent to any of these lands in your inbox. The default is what new messages are sent
			from.
		</p>

		<ul class="address-list">
			{#each addresses as address (address.id)}
				<li class="address-row">
					<div class="min-w-0 flex-1">
						<p class="address-value">{address.address}</p>
						<p class="address-domain">{address.domain_name}</p>
					</div>

					{#if address.is_default}
						<span class="badge">Default</span>
					{:else}
						<button type="button" class="btn-ghost text-xs" onclick={() => makeDefault(address.id)}>
							Make default
						</button>
					{/if}

					{#if addresses.length > 1}
						<button
							type="button"
							class="icon-btn"
							aria-label="Remove {address.address}"
							onclick={() => remove(address.id)}
						>
							<Icon name="delete-bin-line" size={15} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		<form class="add-form" onsubmit={addAddress}>
			<div class="add-field">
				<AddressField
					bind:localPart
					bind:domainId
					domains={data.domains}
					placeholder="another"
					label="Add an address"
				/>
			</div>
			<button type="submit" class="btn-primary" disabled={busy || !localPart.trim()}>
				{busy ? 'Adding…' : 'Add'}
			</button>
		</form>

		{#if selectedDomain && !selectedDomain.receiving_enabled}
			<p class="hint">
				<Icon name="information-line" size={14} />
				Receiving isn't enabled on {selectedDomain.name} — this address can send but won't
				receive.
			</p>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
	</section>

	<section class="surface-lg card">
		<h2><Icon name="global-line" size={18} /> Connected domains</h2>
		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-row">
					<span class="domain-name">{domain.name}</span>
					<span class="caps">
						<span class="chip" class:chip-on={domain.sending_enabled}>send</span>
						<span class="chip" class:chip-on={domain.receiving_enabled}>receive</span>
						<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
					</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.settings-page {
		max-width: 42rem;
	}

	.settings-page h1 {
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.avatar-row {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		margin-top: 1.25rem;
	}

	.avatar-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.avatar-note {
		flex-basis: 100%;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
		margin-top: 1rem;
	}

	.theme-option {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.625rem;
		border-radius: 0.875rem;
		text-align: left;
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: box-shadow 0.15s, background 0.15s;
	}

	.theme-option:hover {
		background: var(--color-surface-muted);
	}

	.theme-option.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	/* A miniature of the app in that theme — fixed colours, not theme tokens. */
	.theme-preview {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.3125rem;
		height: 3.25rem;
		padding: 0.5rem;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.preview-bar {
		width: 60%;
		height: 0.375rem;
		border-radius: 9999px;
	}

	.preview-line {
		width: 100%;
		height: 0.25rem;
		border-radius: 9999px;
		opacity: 0.55;
	}

	.preview-line.short {
		width: 70%;
	}

	.theme-preview-light {
		background: #f5f5f5;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
	}

	.theme-preview-light .preview-bar,
	.theme-preview-light .preview-line {
		background: #0a0a0a;
	}

	.theme-preview-dark {
		background: #17171a;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
	}

	.theme-preview-dark .preview-bar,
	.theme-preview-dark .preview-line {
		background: #f4f4f5;
	}

	.theme-preview-system {
		background: linear-gradient(120deg, #f5f5f5 0 50%, #17171a 50% 100%);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.theme-preview-system .preview-bar,
	.theme-preview-system .preview-line {
		background: linear-gradient(120deg, #0a0a0a 0 50%, #f4f4f5 50% 100%);
	}

	.theme-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.theme-option.selected .theme-label {
		color: var(--color-text);
	}

	.theme-check {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 9999px;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.address-list {
		margin-top: 1rem;
	}

	.address-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0;
	}

	.address-row + .address-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.address-value {
		font-size: 0.875rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.address-domain {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-surface-muted);
	}

	.add-form {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.add-field {
		flex: 1;
		min-width: 0;
	}

	.domain-list {
		margin-top: 1rem;
	}

	.domain-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0;
	}

	.domain-row + .domain-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.domain-name {
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.caps {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
	}

	.chip-on {
		color: var(--color-text-secondary);
	}

	.chip-ok {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
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

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
