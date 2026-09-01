<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import StackHeader from '$lib/components/StackHeader.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import Check from '$lib/components/Check.svelte';
	import { APP_NAME } from '$lib/constants';
	import { formatDeviceActivity } from '$lib/device-activity';
	import { plural, t } from '$lib/i18n';
	import { page } from '$app/stores';
	import { providerName } from '$lib/provider-copy';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let localPart = $state('');
	let newUserDomainId = $state('');
	let name = $state('');
	let password = $state('');
	let makeAdmin = $state(false);

	$effect(() => {
		if (!newUserDomainId && data.domains[0]) {
			newUserDomainId = data.domains[0].id;
		}
	});
	let userError = $state('');
	let creatingUser = $state(false);

	let deleteError = $state('');
	let deletingUser = $state<string | null>(null);

	let roleError = $state('');
	let changingRole = $state<string | null>(null);

	let connecting = $state<string | null>(null);
	let domainError = $state('');

	const connectable = $derived(data.available.filter((domain) => !domain.connected));

	function addressesFor(domainId: string) {
		return data.addresses.filter((address) => address.domain_id === domainId);
	}

	function userLabel(userId: string | null) {
		if (!userId) return t('admin.nobodyUnrouted');
		const match = data.users.find((user) => user.id === userId);
		return match ? `${match.name} (${match.email})` : t('admin.unknownUser');
	}

	function devicePlatform(value: string | null) {
		if (value === 'ios') return t('settings.ios');
		if (value === 'android') return t('settings.android');
		return t('admin.mobile');
	}

	async function createUser(event: SubmitEvent) {
		event.preventDefault();
		userError = '';
		creatingUser = true;

		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					localPart,
					domainId: newUserDomainId,
					password,
					isAdmin: makeAdmin
				})
			});
			const body = await res.json();
			if (!res.ok) {
				userError = body.error ?? t('admin.failedCreateUser');
				return;
			}
			window.location.reload();
		} catch {
			userError = t('common.networkError');
		} finally {
			creatingUser = false;
		}
	}

	/**
	 * The server refuses demoting the last admin, so that error surfaces here
	 * rather than being second-guessed in the UI.
	 */
	async function setRole(userId: string, isAdmin: boolean) {
		roleError = '';
		changingRole = userId;

		try {
			const res = await fetch(`/api/admin/users/${userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isAdmin })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				roleError = body.error ?? t('admin.couldNotChangeRole');
				return;
			}
			window.location.reload();
		} catch {
			roleError = t('common.networkError');
		} finally {
			changingRole = null;
		}
	}

	/**
	 * The server refuses self-deletion and the last remaining admin, so those
	 * errors surface here rather than being pre-empted in the UI.
	 */
	async function removeUser(userId: string, label: string) {
		if (
			!confirm(
				t('admin.deleteUserConfirm', { label })
			)
		) {
			return;
		}

		deleteError = '';
		deletingUser = userId;

		try {
			const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				deleteError = body.error ?? t('admin.failedDeleteUser');
				return;
			}
			window.location.reload();
		} catch {
			deleteError = t('common.networkError');
		} finally {
			deletingUser = null;
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
				domainError = body.error ?? t('onboarding.couldNotConnect');
				return;
			}
			window.location.reload();
		} catch {
			domainError = t('common.networkError');
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
			domainError = body.error ?? t('admin.updateFailed');
			return;
		}
		window.location.reload();
	}

	async function disconnect(domainId: string, domainName: string) {
		if (!confirm(t('admin.disconnectDomainConfirm', { domain: domainName }))) {
			return;
		}

		const res = await fetch(`/api/domains/${domainId}`, { method: 'DELETE' });
		if (res.ok) window.location.reload();
	}
</script>

<svelte:head>
	<title>{t('admin.title', { app: APP_NAME })}</title>
</svelte:head>

<div class="admin-page">
	<StackHeader title={t('nav.admin')} back={false} />

	{#if data.loadError}
		<div class="surface-lg banner">
			<Icon name="error-warning-line" size={16} />
			<span>{data.loadError}</span>
		</div>
	{/if}

	<section class="surface-lg admin-card">
		<h2><Icon name="global-line" size={18} /> {t('nav.domains')}</h2>
		<p class="card-hint">{t('admin.domainsHint')}</p>

		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-item">
					<div class="domain-head">
						<div class="min-w-0">
							<p class="domain-name">{domain.name}</p>
							<p class="domain-sub">
								{plural($page.data.locale, 'admin.addressCount', 'admin.addressCountPlural', addressesFor(domain.id).length)}
								{#if domain.region}· {domain.region}{/if}
							</p>
						</div>
						<div class="chips">
							<span class="chip" class:chip-on={domain.sending_enabled}>{t('settings.send')}</span>
							<span class="chip" class:chip-on={domain.receiving_enabled}>{t('settings.receive')}</span>
							<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
						</div>
					</div>

					<div class="domain-controls">
						<label class="control">
							<span class="control-label">{t('admin.catchall')}</span>
							<select
								value={domain.catchall_user_id ?? ''}
								onchange={(event) =>
									updateDomain(domain.id, {
										catchallUserId: (event.currentTarget as HTMLSelectElement).value || null
									})}
							>
								<option value="">{t('admin.nobodyHold')}</option>
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
								<Icon name="refresh-line" size={14} /> {t('admin.resync')}
							</button>
							<button
								type="button"
								class="btn-ghost text-xs"
								onclick={() => disconnect(domain.id, domain.name)}
							>
								{t('common.disconnect')}
							</button>
						</div>
					</div>

					{#if !domain.receiving_enabled}
						<p class="hint">
							<Icon name="information-line" size={13} />
							{data.providerKind === 'cloudflare'
								? t('admin.inboundOffRouting')
								: t('admin.inboundOffMx')}
						</p>
					{/if}
					{#if domain.catchall_user_id}
						<p class="hint">
							<Icon name="user-received-line" size={13} />
							{t('admin.goesTo', { label: userLabel(domain.catchall_user_id) })}
						</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if connectable.length > 0}
			<div class="connect-block">
				<p class="connect-title">
					{t('admin.availableIn', { provider: providerName(data.providerKind) })}
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
								{connecting === domain.id ? t('common.connecting') : t('common.connect')}
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
			<h2><Icon name="user-add-line" size={18} /> {t('admin.newUser')}</h2>
			<p class="card-hint">{t('admin.newUserHint')}</p>
			<form class="mt-4 space-y-3" onsubmit={createUser}>
				<input type="text" bind:value={name} required placeholder={t('admin.displayName')} class="admin-input" />
				<AddressField
					bind:localPart
					bind:domainId={newUserDomainId}
					domains={data.domains}
					placeholder="name"
					label={t('settings.addressLabel')}
				/>
				<input
					type="text"
					bind:value={password}
					required
					minlength="8"
					placeholder={t('admin.temporaryPassword')}
					class="admin-input"
				/>

				<div class="role-row">
					<Check
						label={t('admin.makeAdmin')}
						caption={t('nav.admin')}
						checked={makeAdmin}
						onchange={(next) => (makeAdmin = next)}
					/>
					<span class="role-hint">{t('admin.roleHint')}</span>
				</div>

				{#if userError}<p class="error">{userError}</p>{/if}

				<button type="submit" disabled={creatingUser} class="btn-primary">
					{creatingUser ? t('common.creating') : t('common.create')}
				</button>
			</form>
		</section>

		<section class="surface-lg admin-card">
			<h2><Icon name="group-line" size={18} /> {plural($page.data.locale, 'admin.usersCount', 'admin.usersCountPlural', data.users.length)}</h2>
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
							{#if user.must_change_password}
								<p class="user-status">{t('admin.pendingAccountSetup')}</p>
							{/if}
						</div>
						{#if user.id === data.user?.id}
							{#if user.is_admin}
								<span class="admin-badge">{t('nav.admin')}</span>
							{/if}
						{:else}
							<Check
								label={user.is_admin
									? t('admin.removeAdminFrom', { name: user.name })
									: t('admin.makeNamedAdmin', { name: user.name })}
								caption={t('nav.admin')}
								checked={user.is_admin}
								disabled={changingRole === user.id}
								onchange={(next) => setRole(user.id, next)}
							/>
						{/if}
						{#if user.id !== data.user?.id}
							<button
								type="button"
								class="user-delete"
								title={t('admin.deleteNamed', { name: user.name })}
								aria-label={t('admin.deleteNamed', { name: user.name })}
								disabled={deletingUser === user.id}
								onclick={() => removeUser(user.id, user.name)}
							>
								<Icon name="delete-bin-line" size={16} />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if roleError}<p class="error">{roleError}</p>{/if}
			{#if deleteError}<p class="error">{deleteError}</p>{/if}
		</section>
	</div>

	<section class="surface-lg admin-card">
		<h2><Icon name="smartphone-line" size={18} /> {t('admin.mobileDevices')}</h2>
		<p class="card-hint">
			{t('admin.mobileDevicesHint')}
		</p>

		{#if data.devices.length > 0}
			<ul class="device-list">
				{#each data.devices as device (device.id)}
					<li class="device-row">
						<div class="device-icon" aria-hidden="true">
							<Icon name="smartphone-line" size={16} />
						</div>
						<div class="min-w-0 flex-1">
							<p class="user-name">{device.device_name ?? t('admin.mobileDevice')}</p>
							<p class="user-email">{device.user_name} · {device.user_email}</p>
						</div>
						<div class="device-detail">
							<p>{devicePlatform(device.device_platform)}</p>
							<p>{formatDeviceActivity(device.last_seen_at, $page.data.locale)}</p>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">{t('admin.noMobileDevices')}</p>
		{/if}
	</section>

	{#if data.unrouted.length > 0}
		<section class="surface-lg admin-card">
			<h2><Icon name="question-mark" size={18} /> {t('admin.unrouted')}</h2>
			<p class="card-hint">{t('admin.unroutedHint')}</p>
			<ul class="user-list">
				{#each data.unrouted as item (item.id)}
					<li class="user-row">
						<div class="min-w-0 flex-1">
							<p class="user-name">{item.subject || t('mailbox.noSubject')}</p>
							<p class="user-email">{item.from_addr} → {item.to_addr}</p>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.admin-page :global(.stack-header) {
		margin-bottom: 0;
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

	.user-status {
		margin-top: 0.1875rem;
		font-size: 0.6875rem;
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

	.device-list {
		margin-top: 1rem;
	}

	.device-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
	}

	.device-row + .device-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.device-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.75rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.device-detail {
		flex-shrink: 0;
		text-align: right;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	@media (max-width: 36rem) {
		.device-row {
			align-items: flex-start;
			flex-wrap: wrap;
		}

		.device-detail {
			width: 100%;
			padding-left: 3rem;
			text-align: left;
		}
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

	.role-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.role-hint {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.user-delete {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 0.5rem;
		color: var(--color-muted);
		background: transparent;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.user-delete:hover:not(:disabled) {
		color: var(--color-danger);
		background: var(--color-surface-muted);
	}

	.user-delete:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-focus-halo);
	}

	.user-delete:disabled {
		opacity: 0.4;
		cursor: default;
	}

	@media (max-width: 900px) {
		.user-delete {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.admin-card {
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
