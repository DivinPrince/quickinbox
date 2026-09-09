<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '$lib/components/Icon.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import { loginHref } from '$lib/next-url';
	import { clientBrand, clientInitials, redirectHost } from '$lib/oauth-brand';
	import type { LinkedAccount } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const request = $derived(data.request);
	const invalid = $derived(form?.invalid ?? data.invalid);
	const brand = $derived(request ? clientBrand(request.client) : null);
	const clientName = $derived(request?.client.client_name ?? '');
	const host = $derived(request ? redirectHost(request.redirectUri) : '');
	const currentPath = $derived(`${$page.url.pathname}${$page.url.search}`);

	/** Every account on this browser, active first; falls back to just the signed-in user. */
	const accounts = $derived.by((): LinkedAccount[] => {
		if (data.accounts.length > 0) return data.accounts;
		if (!data.user) return [];
		return [{ id: data.user.id, email: data.user.email, name: data.user.name, address: null, current: true }];
	});
	let chosenId = $state('');
	$effect(() => {
		if (!chosenId && accounts[0]) chosenId = accounts[0].id;
	});

	function initials(account: LinkedAccount): string {
		return clientInitials(account.name || account.email);
	}

	const SCOPE_COPY: Record<string, { icon: string; title: string; detail: string }> = $derived({
		'mail:read': {
			icon: 'mail-open-line',
			title: t('oauth.scopeReadTitle'),
			detail: t('oauth.scopeReadDetail')
		},
		'mail:send': {
			icon: 'mail-send-line',
			title: t('oauth.scopeSendTitle'),
			detail: t('oauth.scopeSendDetail')
		}
	});
</script>

<svelte:head>
	<title>{request ? t('oauth.title', { client: clientName, app: APP_NAME }) : t('oauth.invalidTitle')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="auth-shell">
	<div class="auth-card consent">
		{#if request && !invalid}
			<div class="pair" aria-hidden="true">
				<div class="tile client" style={brand ? `--tile: ${brand.color}` : undefined}>
					{#if request.client.logo_uri}
						<img src={request.client.logo_uri} alt="" width="56" height="56" referrerpolicy="no-referrer" />
					{:else if brand}
						<Icon name={brand.icon} size={32} />
					{:else}
						<span class="initials">{clientInitials(clientName)}</span>
					{/if}
				</div>
				<div class="dots">
					<span></span><span></span><span></span>
				</div>
				<div class="tile app"><Logo size={56} /></div>
			</div>

			<h1>{t('oauth.title', { client: clientName, app: APP_NAME })}</h1>
			<p class="sub">
				{t('oauth.subtitle', { client: clientName })}
				{#if request.client.client_uri}
					<a class="site" href={request.client.client_uri} target="_blank" rel="noopener noreferrer">
						<Icon name="external-link-line" size={12} />
						{redirectHost(request.client.client_uri)}
					</a>
				{/if}
			</p>

			<h2 class="section-label">{t('oauth.willBeAbleTo', { client: clientName })}</h2>
			<ul class="perms">
				{#each request.scope as scope (scope)}
					{@const copy = SCOPE_COPY[scope]}
					<li>
						<span class="perm-icon"><Icon name={copy.icon} size={17} /></span>
						<div>
							<strong>{copy.title}</strong>
							<small>{copy.detail}</small>
						</div>
					</li>
				{/each}
				<li class="perm-no">
					<span class="perm-icon"><Icon name="lock-2-line" size={17} /></span>
					<div><small>{t('oauth.cannot')}</small></div>
				</li>
			</ul>

			<form method="POST" class="decision">
				<input type="hidden" name="client_id" value={request.client.client_id} />
				<input type="hidden" name="redirect_uri" value={request.redirectUri} />
				<input type="hidden" name="response_type" value="code" />
				<input type="hidden" name="scope" value={request.scope.join(' ')} />
				<input type="hidden" name="code_challenge" value={request.codeChallenge} />
				<input type="hidden" name="code_challenge_method" value="S256" />
				<input type="hidden" name="resource" value={request.resource} />
				{#if request.state !== null}
					<input type="hidden" name="state" value={request.state} />
				{/if}

				<h2 class="section-label">
					{accounts.length > 1 ? t('oauth.chooseAccount') : t('oauth.signedInAs')}
				</h2>
				<div class="accounts" role={accounts.length > 1 ? 'radiogroup' : undefined}>
					{#each accounts as account (account.id)}
						<label class="account" class:selected={chosenId === account.id}>
							{#if accounts.length > 1}
								<input type="radio" name="user_id" value={account.id} bind:group={chosenId} />
							{:else}
								<input type="hidden" name="user_id" value={account.id} />
							{/if}
							<span class="avatar">{initials(account)}</span>
							<span class="who">
								<strong>{account.name || account.email}</strong>
								<small>{account.address ?? account.email}</small>
							</span>
							{#if accounts.length > 1}
								<span class="tick"><Icon name="check-line" size={16} /></span>
							{/if}
						</label>
					{/each}
					<a class="another" href={loginHref(currentPath, { add: true })}>
						<Icon name="user-add-line" size={15} />
						{t('oauth.useAnotherAccount')}
					</a>
				</div>

				<div class="actions">
					<button type="submit" name="decision" value="deny" class="btn-ghost" formnovalidate>
						{t('oauth.deny')}
					</button>
					<button type="submit" name="decision" value="allow" class="btn-primary">
						{t('oauth.allow')}
					</button>
				</div>
			</form>

			<p class="fine">
				<span class="fine-row"><Icon name="arrow-go-back-line" size={12} /> {t('oauth.redirectNote', { host })}</span>
				<a href="/settings/connections">{t('oauth.manageHint')}</a>
			</p>
		{:else}
			<div class="pair" aria-hidden="true">
				<div class="tile app danger"><Icon name="error-warning-line" size={30} /></div>
			</div>
			<h1>{t('oauth.invalidTitle')}</h1>
			<p class="sub">{t('oauth.invalidHint')}</p>
			{#if invalid}
				<p class="reason"><code>{invalid.code}</code> {invalid.message}</p>
			{/if}
			<div class="actions single">
				<a href="/inbox" class="btn-ghost">{t('auth.backToInbox')}</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.consent {
		max-width: 26rem;
		text-align: center;
	}

	.pair {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.875rem;
		margin-bottom: 1.5rem;
	}

	.tile {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		overflow: hidden;
		border-radius: 26%;
		background: var(--tile, var(--color-surface-muted));
		color: var(--tile-fg, var(--color-text));
		box-shadow: inset 0 0 0 1px var(--color-line), var(--shadow-sm);
	}

	.tile.client[style] {
		--tile-fg: #fff;
	}

	.tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tile.danger {
		--tile: color-mix(in srgb, var(--color-danger) 14%, transparent);
		--tile-fg: var(--color-danger);
	}

	.initials {
		font-size: 1.125rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.dots {
		display: flex;
		gap: 0.3rem;
	}

	.dots span {
		width: 0.3rem;
		height: 0.3rem;
		border-radius: 999px;
		background: var(--color-muted);
		animation: pulse 1.6s ease-in-out infinite;
	}

	.dots span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dots span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dots span {
			animation: none;
			opacity: 0.6;
		}
	}

	h1 {
		text-wrap: balance;
	}

	.sub {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.site {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.25rem;
		color: var(--color-accent-text);
	}

	.section-label {
		margin: 1.5rem 0 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-align: left;
		color: var(--color-muted);
	}

	.perms {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		text-align: left;
		border-radius: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.perms li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
	}

	.perms li + li {
		border-top: 1px solid var(--color-line);
	}

	.perms strong {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.perms small {
		display: block;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.perm-icon {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.625rem;
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
	}

	.perm-no .perm-icon {
		background: transparent;
		color: var(--color-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.accounts {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		text-align: left;
	}

	.account {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		cursor: default;
	}

	.account input[type='radio'] {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.account:has(input[type='radio']) {
		cursor: pointer;
	}

	.account:has(input[type='radio']):hover {
		background: var(--color-surface-hover);
	}

	.account.selected:has(input[type='radio']) {
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.account:has(input[type='radio']:focus-visible) {
		outline: 2px solid var(--color-focus-line);
		outline-offset: 2px;
	}

	.avatar {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-accent);
		color: var(--color-on-accent);
	}

	.who {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.who strong {
		overflow: hidden;
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.who small {
		overflow: hidden;
		font-size: 0.75rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--color-text-secondary);
	}

	.tick {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 999px;
		color: var(--color-on-accent);
		background: var(--color-accent);
		opacity: 0;
		transform: scale(0.8);
		transition: opacity 0.15s, transform 0.15s;
	}

	.account.selected .tick {
		opacity: 1;
		transform: none;
	}

	.another {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		align-self: flex-start;
		padding: 0.375rem 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.another:hover {
		color: var(--color-text);
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.625rem;
		margin-top: 1.5rem;
	}

	.actions.single {
		grid-template-columns: 1fr;
	}

	.actions .btn-ghost,
	.actions .btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1rem;
		font-size: 0.9375rem;
	}

	.actions .btn-ghost {
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.fine {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		margin-top: 1.25rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.fine-row {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.fine a {
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.reason {
		margin-top: 1rem;
		padding: 0.75rem 0.875rem;
		font-size: 0.8125rem;
		text-align: left;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		color: var(--color-text-secondary);
	}

	.reason code {
		margin-right: 0.375rem;
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.consent {
			justify-content: center;
		}
	}
</style>
