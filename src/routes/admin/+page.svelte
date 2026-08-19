<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let localPart = $state('');
	let newUserDomainId = $state('');
	let name = $state('');
	let password = $state('');

	$effect(() => {
		if (!newUserDomainId && data.domains[0]) {
			newUserDomainId = data.domains[0].id;
		}
	});
	let userError = $state('');
	let creatingUser = $state(false);

	let connecting = $state<string | null>(null);
	let domainError = $state('');

	const connectable = $derived(data.available.filter((domain) => !domain.connected));

	function addressesFor(domainId: string) {
		return data.addresses.filter((address) => address.domain_id === domainId);
	}

	function userLabel(userId: string | null) {
		if (!userId) return 'Nobody (unrouted mail is held)';
		const match = data.users.find((user) => user.id === userId);
		return match ? `${match.name} (${match.email})` : 'Unknown user';
	}

	async function createUser(event: SubmitEvent) {
		event.preventDefault();
		userError = '';
		creatingUser = true;

		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, localPart, domainId: newUserDomainId, password })
			});
			const body = await res.json();
			if (!res.ok) {
				userError = body.error ?? 'Failed to create user';
				return;
			}
			window.location.reload();
		} catch {
			userError = 'Network error';
		} finally {
			creatingUser = false;
		}
	}

	async function connect(domainId: string) {
		connecting = domainId;
		domainError = '';

		try {
			const res = await fetch('/api/domains', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId })
			});
			const body = await res.json();
			if (!res.ok) {
				domainError = body.error ?? 'Could not connect that domain';
				return;
			}
			window.location.reload();
		} catch {
			domainError = 'Network error';
		} finally {
			connecting = null;
		}
	}

	async function updateDomain(domainId: string, patch: Record<string, unknown>) {
		domainError = '';
		const res = await fetch(`/api/domains/${domainId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		const body = await res.json();
		if (!res.ok) {
			domainError = body.error ?? 'Update failed';
			return;
		}
		window.location.reload();
	}

	async function disconnect(domainId: string, domainName: string) {
		if (!confirm(`Stop using ${domainName} in this dashboard? Mail already received is kept.`)) {
			return;
		}

		const res = await fetch(`/api/domains/${domainId}`, { method: 'DELETE' });
		if (res.ok) window.location.reload();
	}
</script>

<svelte:head>
	<title>Admin — Mail</title>
</svelte:head>

<div class="admin-page">
	<h1>Admin</h1>

	{#if data.loadError}
		<div class="surface-lg banner">
			<Icon name="error-warning-line" size={16} />
			<span>{data.loadError}</span>
		</div>
	{/if}

	<section class="surface-lg admin-card">
		<h2><Icon name="global-line" size={18} /> Domains</h2>
		<p class="card-hint">Catch-all gets unmatched mail.</p>

		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-item">
					<div class="domain-head">
						<div class="min-w-0">
							<p class="domain-name">{domain.name}</p>
							<p class="domain-sub">
								{addressesFor(domain.id).length} address{addressesFor(domain.id).length === 1
									? ''
									: 'es'}
								{#if domain.region}· {domain.region}{/if}
							</p>
						</div>
						<div class="chips">
							<span class="chip" class:chip-on={domain.sending_enabled}>send</span>
							<span class="chip" class:chip-on={domain.receiving_enabled}>receive</span>
							<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
						</div>
					</div>

					<div class="domain-controls">
						<label class="control">
							<span class="control-label">Catch-all</span>
							<select
								value={domain.catchall_user_id ?? ''}
								onchange={(event) =>
									updateDomain(domain.id, {
										catchallUserId: (event.currentTarget as HTMLSelectElement).value || null
									})}
							>
								<option value="">Nobody (hold as unrouted)</option>
								{#each data.users as user (user.id)}
									<option value={user.id}>{user.name} — {user.email}</option>
								{/each}
							</select>
						</label>

						<div class="control-actions">
							<button
								type="button"
								class="btn-ghost text-xs"
								onclick={() => updateDomain(domain.id, { refresh: true })}
							>
								<Icon name="refresh-line" size={14} /> Re-sync
							</button>
							<button
								type="button"
								class="btn-ghost text-xs"
								onclick={() => disconnect(domain.id, domain.name)}
							>
								Disconnect
							</button>
						</div>
					</div>

					{#if !domain.receiving_enabled}
						<p class="hint">
							<Icon name="information-line" size={13} />
							Inbound is off
							{data.providerKind === 'cloudflare'
								? '— point Email Routing’s catch-all at this Worker'
								: '— add the MX record'}
							to receive.
						</p>
					{/if}
					{#if domain.catchall_user_id}
						<p class="hint">
							<Icon name="user-received-line" size={13} />
							Goes to {userLabel(domain.catchall_user_id)}.
						</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if connectable.length > 0}
			<div class="connect-block">
				<p class="connect-title">
					Available in {data.providerKind === 'cloudflare' ? 'Cloudflare Email' : 'Resend'}
				</p>
				<ul class="connect-list">
					{#each connectable as domain (domain.id)}
						<li class="connect-row">
							<div class="min-w-0">
								<p class="domain-name">{domain.name}</p>
								<p class="domain-sub">{domain.status}{#if domain.region} · {domain.region}{/if}</p>
							</div>
							<button
								type="button"
								class="btn-primary text-xs"
								disabled={connecting === domain.id}
								onclick={() => connect(domain.id)}
							>
								{connecting === domain.id ? 'Connecting…' : 'Connect'}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if domainError}<p class="error">{domainError}</p>{/if}
	</section>

	<div class="admin-grid">
		<section class="surface-lg admin-card">
			<h2><Icon name="user-add-line" size={18} /> New user</h2>
			<p class="card-hint">Address is their login.</p>
			<form class="mt-4 space-y-3" onsubmit={createUser}>
				<input type="text" bind:value={name} required placeholder="Display name" class="admin-input" />
				<AddressField
					bind:localPart
					bind:domainId={newUserDomainId}
					domains={data.domains}
					placeholder="name"
					label="Address"
				/>
				<input
					type="text"
					bind:value={password}
					required
					minlength="8"
					placeholder="Temporary password"
					class="admin-input"
				/>

				{#if userError}<p class="error">{userError}</p>{/if}

				<button type="submit" disabled={creatingUser} class="btn-primary">
					{creatingUser ? 'Creating…' : 'Create'}
				</button>
			</form>
		</section>

		<section class="surface-lg admin-card">
			<h2><Icon name="group-line" size={18} /> {data.users.length} users</h2>
			<ul class="user-list">
				{#each data.users as user (user.id)}
					<li class="user-row">
						<div class="user-avatar">{(user.name[0] ?? '?').toUpperCase()}</div>
						<div class="min-w-0 flex-1">
							<p class="user-name">{user.name}</p>
							<p class="user-email">
								{data.addresses
									.filter((address) => address.user_id === user.id)
									.map((address) => address.address)
									.join(', ') || user.email}
							</p>
						</div>
						{#if user.is_admin}
							<span class="admin-badge">Admin</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	</div>

	{#if data.unrouted.length > 0}
		<section class="surface-lg admin-card">
			<h2><Icon name="question-mark" size={18} /> Unrouted mail</h2>
			<p class="card-hint">No matching address or catch-all.</p>
			<ul class="user-list">
				{#each data.unrouted as item (item.id)}
					<li class="user-row">
						<div class="min-w-0 flex-1">
							<p class="user-name">{item.subject || '(no subject)'}</p>
							<p class="user-email">{item.from_addr} → {item.to_addr}</p>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.admin-page h1 {
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.875rem 1.125rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: 0 0 0 1px var(--tone-notice-line), var(--shadow-sm);
	}

	.admin-grid {
		display: grid;
		gap: 1.25rem;
		margin-top: 1.25rem;
	}

	@media (min-width: 900px) {
		.admin-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.admin-card {
		margin-top: 1.25rem;
		padding: 1.5rem;
	}

	.admin-grid .admin-card {
		margin-top: 0;
	}

	.admin-card h2 {
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

	.domain-list {
		margin-top: 1rem;
	}

	.domain-item {
		padding: 1rem 0;
	}

	.domain-item + .domain-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.domain-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.domain-name {
		font-size: 0.9375rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.domain-sub {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.chips {
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

	.domain-controls {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.875rem;
	}

	.control {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.control-label {
		font-size: 0.6875rem;
		color: var(--color-muted);
	}

	.control select {
		max-width: 100%;
		padding: 0.4375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		outline: none;
		cursor: pointer;
	}

	.control-actions {
		display: flex;
		gap: 0.25rem;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.connect-block {
		margin-top: 1.25rem;
		padding-top: 1rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.connect-title {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-muted);
	}

	.connect-list {
		margin-top: 0.625rem;
	}

	.connect-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.admin-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.admin-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.user-list {
		margin-top: 1rem;
	}

	.user-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
	}

	.user-row + .user-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.user-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.user-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.user-email {
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.admin-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
