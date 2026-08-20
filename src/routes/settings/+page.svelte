<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Check from '$lib/components/Check.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import DesktopNotifications from '$lib/components/DesktopNotifications.svelte';
	import {
		readThemePreference,
		setThemePreference,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme';
	import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';
	import type { ApiTokenSummary, MailAddress } from '$lib/types';
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

	let signature = $state(untrack(() => data.signature));
	let signatureBusy = $state(false);
	let signatureError = $state('');
	let signatureSaved = $state(false);

	async function saveSignature(event: SubmitEvent) {
		event.preventDefault();
		signatureBusy = true;
		signatureError = '';
		signatureSaved = false;

		try {
			const res = await fetch('/api/settings/signature', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature })
			});
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not save signature';
				return;
			}

			signature = body.signature;
			signatureSaved = true;
		} catch {
			signatureError = 'Network error';
		} finally {
			signatureBusy = false;
		}
	}

	// Server data until an edit happens, then whatever the API returned.
	let edited = $state<MailAddress[] | null>(null);
	const addresses = $derived(edited ?? data.addresses);

	let localPart = $state('');
	let domainId = $state('');
	let error = $state('');
	let busy = $state(false);

	let keyName = $state('');
	let sendScope = $state(true);
	let readScope = $state(true);
	let adminScope = $state(false);
	let tokens = $state<ApiTokenSummary[]>([]);
	let hydrated = $state(false);
	$effect(() => {
		if (!hydrated) {
			tokens = data.apiTokens;
			hydrated = true;
		}
	});
	let keyBusy = $state(false);
	let keyError = $state('');
	let creating = $state(false);
	let revealed = $state<{ summary: ApiTokenSummary; token: string } | null>(null);
	let copied = $state(false);
	let installCopied = $state(false);
	const installCommand =
		'curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickmail/main/scripts/install.sh | sh';

	const canCreateKey = $derived(
		Boolean(keyName.trim()) && (sendScope || readScope || (data.isAdmin && adminScope))
	);

	function openCreate() {
		keyName = '';
		sendScope = true;
		readScope = true;
		adminScope = false;
		keyError = '';
		revealed = null;
		copied = false;
		creating = true;
	}

	function closeCreate() {
		creating = false;
		revealed = null;
		copied = false;
		keyError = '';
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (creating && event.key === 'Escape' && !revealed) closeCreate();
	}

	async function createKey(event?: SubmitEvent) {
		if (event) event.preventDefault();
		keyBusy = true;
		keyError = '';
		try {
			const scopes = [];
			if (sendScope) scopes.push('mail:send');
			if (readScope) scopes.push('mail:read');
			if (data.isAdmin && adminScope) scopes.push('admin');

			const res = await fetch('/api/apikeys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: keyName, scopes })
			});
			const body = await res.json();
			if (!res.ok) {
				keyError = body.error ?? 'Could not create the API key';
				return;
			}
			tokens = [body.tokenMeta, ...tokens.filter((token) => token.id !== body.tokenMeta.id)];
			revealed = { summary: body.tokenMeta, token: body.token };
			copied = false;
			keyName = '';
		} catch {
			keyError = 'Network error';
		} finally {
			keyBusy = false;
		}
	}

	async function copyKey() {
		if (!revealed) return;
		try {
			await navigator.clipboard.writeText(revealed.token);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard unavailable — the box is still selectable */
		}
	}

	async function copyInstall() {
		try {
			await navigator.clipboard.writeText(installCommand);
			installCopied = true;
			setTimeout(() => (installCopied = false), 1600);
		} catch {
			/* clipboard unavailable — the command is still selectable */
		}
	}

	async function revokeKey(id: string) {
		if (!confirm('Revoke this key?')) return;
		const res = await fetch(`/api/apikeys/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			keyError = body.error ?? 'Could not revoke that key';
			return;
		}
		tokens = body.tokens;
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	}

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

<svelte:window onkeydown={handleWindowKeydown} />

<div class="settings-page">
	<h1>Settings</h1>

	<section class="surface-lg card">
		<h2><Icon name="contrast-2-line" size={18} /> Appearance</h2>

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

	<DesktopNotifications configured={data.push.configured} publicKey={data.push.publicKey} />

	<section class="surface-lg card">
		<h2><Icon name="pencil-line" size={18} /> Signature</h2>

		<form class="signature-form" onsubmit={saveSignature}>
			<textarea
				id="email-signature"
				bind:value={signature}
				maxlength={MAX_EMAIL_SIGNATURE_LENGTH}
				rows="3"
				placeholder={'Best,\nEmmanuel'}
				class="signature-input"
			></textarea>

			<div class="signature-actions">
				<span class="character-count">{signature.length}/{MAX_EMAIL_SIGNATURE_LENGTH}</span>
				<button type="submit" class="btn-primary" disabled={signatureBusy}>
					{signatureBusy ? 'Saving…' : 'Save'}
				</button>
			</div>

			{#if signatureError}<p class="error">{signatureError}</p>{/if}
			{#if signatureSaved}<p class="saved">Saved</p>{/if}
		</form>
	</section>

	<section class="surface-lg card">
		<h2><Icon name="at-line" size={18} /> Addresses</h2>

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
				{selectedDomain.name} can send, but inbound is off.
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

	<section class="surface-lg card">
		<div class="card-head">
			<h2><Icon name="key-2-line" size={18} /> API keys</h2>
			<button type="button" class="btn-primary" onclick={openCreate}>
				<Icon name="add-line" size={15} />
				New
			</button>
		</div>

		{#if tokens.length}
			<ul class="key-list">
				{#each tokens as token (token.id)}
					<li class="key-row">
						<div class="min-w-0 flex-1">
							<p class="key-name">{token.name}</p>
							<p class="key-meta">
								<code>{token.preview}</code>
								<span class="caps">
									{#each token.scopes as scope (scope)}<span class="chip">{scope}</span>{/each}
								</span>
							</p>
						</div>
						<span class="key-created">{formatDate(token.created_at)}</span>
						<button
							type="button"
							class="icon-btn"
							aria-label="Revoke {token.name}"
							onclick={() => revokeKey(token.id)}
						>
							<Icon name="delete-bin-line" size={15} />
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">No keys</p>
		{/if}

		{#if keyError && !creating}<p class="error">{keyError}</p>{/if}

		<div class="install-row">
			<code>{installCommand}</code>
			<button type="button" class="icon-btn" aria-label="Copy install command" onclick={copyInstall}>
				<Icon name={installCopied ? 'check-line' : 'file-copy-line'} size={15} />
			</button>
		</div>
	</section>
</div>

{#if creating}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget && !revealed) closeCreate();
		}}
	>
		<div
			class="key-modal"
			role="dialog"
			aria-modal="true"
			aria-label={revealed ? 'Copy API key' : 'New API key'}
			tabindex="-1"
		>
			<div class="modal-head">
				<h3>
					<Icon name="key-2-line" size={16} />
					{revealed ? 'Copy this key' : 'New API key'}
				</h3>
				<button type="button" class="icon-btn" aria-label="Close" onclick={closeCreate}>
					<Icon name="close-line" size={16} />
				</button>
			</div>

			{#if revealed}
				<p class="modal-note">Shown once. Copy it now.</p>
				<pre class="token-box">{revealed.token}</pre>
				<div class="modal-actions">
					<button type="button" class="btn-primary" onclick={copyKey}>
						<Icon name={copied ? 'check-line' : 'file-copy-line'} size={15} />
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button type="button" class="btn-ghost" onclick={closeCreate}>Done</button>
				</div>
			{:else}
				<form class="key-form" onsubmit={createKey}>
					<label class="sr-only" for="apikey-name">Key name</label>
					<input
						id="apikey-name"
						class="text-input"
						placeholder="Name"
						value={keyName}
						autofocus
						oninput={(event) => (keyName = event.currentTarget.value)}
					/>

					<div class="scope-row">
						<Check label="Send mail" caption="send" checked={sendScope} onchange={(next) => (sendScope = next)} />
						<Check label="Read mail" caption="read" checked={readScope} onchange={(next) => (readScope = next)} />
						{#if data.isAdmin}
							<Check
								label="Admin"
								caption="admin"
								checked={adminScope}
								onchange={(next) => (adminScope = next)}
							/>
						{/if}
					</div>

					{#if keyError}<p class="error">{keyError}</p>{/if}

					<div class="modal-actions">
						<button type="button" class="btn-ghost" onclick={closeCreate}>Cancel</button>
						<button type="submit" class="btn-primary" disabled={keyBusy || !canCreateKey}>
							{keyBusy ? 'Creating…' : 'Create'}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

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

	.card-head {
		display: flex;
		align-items: center;
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

	.signature-form {
		margin-top: 1rem;
	}

	.signature-input {
		width: 100%;
		padding: 0.75rem 0.875rem;
		resize: vertical;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		line-height: 1.55;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.signature-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.signature-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.character-count {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.empty {
		margin-top: 1rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.key-form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin-top: 1rem;
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: box-shadow 0.15s;
	}

	.text-input::placeholder {
		color: var(--color-muted);
	}

	.text-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.scope-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.key-list {
		margin-top: 1rem;
	}

	.key-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0;
	}

	.key-row + .key-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.key-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.key-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.key-meta code {
		font-size: 0.75rem;
	}

	.key-created {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-scrim);
	}

	.key-modal {
		width: 100%;
		max-width: 26rem;
		padding: 1.25rem 1.375rem 1.375rem;
		border-radius: 1.25rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.modal-head h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.modal-note {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.token-box {
		overflow-x: auto;
		margin-top: 0.875rem;
		padding: 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		word-break: break-all;
		white-space: pre-wrap;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.key-form .modal-actions {
		margin-top: 0.25rem;
	}

	.install-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.install-row code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		font-size: 0.75rem;
		white-space: nowrap;
	}
</style>
