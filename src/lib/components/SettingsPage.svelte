<script lang="ts">
	import { page } from '$app/stores';
	import { tick, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StackHeader from '$lib/components/StackHeader.svelte';
	import Check from '$lib/components/Check.svelte';
	import AddressField from '$lib/components/AddressField.svelte';
	import DesktopNotifications from '$lib/components/DesktopNotifications.svelte';
	import InstallApp from '$lib/components/InstallApp.svelte';
	import {
		readThemePreference,
		setThemePreference,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme';
	import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';
	import { APP_NAME } from '$lib/constants';
	import { formatDeviceActivity } from '$lib/device-activity';
	import { intlLocale, t } from '$lib/i18n';
	import type { ApiTokenSummary, Domain, MailAddress } from '$lib/types';
	import type { SettingsSection } from '$lib/settings-section';
	import UiThemePicker from './UiThemePicker.svelte';
	import LocalePicker from './LocalePicker.svelte';

	type DeviceSession = {
		id: string;
		device_name: string | null;
		device_platform: string | null;
		created_at: string;
		last_seen_at: string | null;
		expires_at: string;
		is_current: boolean;
	};

	type SettingsData = {
		domains: Domain[];
		addresses: MailAddress[];
		signature: string;
		apiTokens: ApiTokenSummary[];
		push: { configured: boolean; publicKey: string | null };
		isAdmin: boolean;
		devices: DeviceSession[];
	};

	let {
		data,
		section = 'all'
	}: {
		data: SettingsData;
		section?: SettingsSection;
	} = $props();

	const showAll = $derived(section === 'all');
	const zeroChrome = $derived(($page.data.uiTheme ?? 'zero') !== 'classic');
	function show(name: Exclude<SettingsSection, 'all' | 'shortcuts'>): boolean {
		return showAll || section === name;
	}

	const SHORTCUTS = $derived<{ keys: string; label: string }[]>([
		{ keys: '⌘K', label: t('shortcuts.search') },
		{ keys: 'C', label: t('shortcuts.compose') },
		{ keys: 'E', label: t('shortcuts.archive') },
		{ keys: 'D', label: t('shortcuts.moveToBin') },
		{ keys: 'R', label: t('shortcuts.reply') },
		{ keys: 'A', label: t('shortcuts.replyAll') },
		{ keys: 'F', label: t('shortcuts.forward') },
		{ keys: 'S', label: t('shortcuts.star') },
		{ keys: 'U', label: t('shortcuts.markUnread') },
		{ keys: 'G then I', label: t('shortcuts.goToInbox') },
		{ keys: 'G then D', label: t('shortcuts.goToDrafts') },
		{ keys: 'G then T', label: t('shortcuts.goToSent') },
		{ keys: 'G then A', label: t('shortcuts.goToArchive') },
		{ keys: 'G then B', label: t('shortcuts.goToBin') },
		{ keys: 'G then S', label: t('shortcuts.goToSettings') },
		{ keys: '1 / 2 / 3', label: t('shortcuts.filters') },
		{ keys: '⌘↵', label: t('shortcuts.send') },
		{ keys: 'Esc', label: t('shortcuts.close') },
		{ keys: '?', label: t('shortcuts.title') }
	]);

	function sectionTitle(name: SettingsSection): string {
		switch (name) {
			case 'general':
				return t('nav.general');
			case 'appearance':
				return t('nav.appearance');
			case 'connections':
				return t('nav.connections');
			case 'notifications':
				return t('nav.notifications');
			case 'shortcuts':
				return t('nav.shortcuts');
			case 'all':
				return t('nav.settings');
			default: {
				const _never: never = name;
				return _never;
			}
		}
	}

	function themeLabel(value: ThemePreference): string {
		switch (value) {
			case 'light':
				return t('settings.themeLight');
			case 'dark':
				return t('settings.themeDark');
			case 'system':
				return t('settings.themeSystem');
			default: {
				const _never: never = value;
				return _never;
			}
		}
	}

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
				signatureError = body.error ?? t('settings.couldNotSaveSignature');
				return;
			}

			signature = body.signature;
			signatureSaved = true;
		} catch {
			signatureError = t('common.networkError');
		} finally {
			signatureBusy = false;
		}
	}

	// Server data until an edit happens, then whatever the API returned.
	let edited = $state<MailAddress[] | null>(null);
	const addresses = $derived(edited ?? data.addresses);

	let localPart = $state('');
	let displayName = $state('');
	let domainId = $state('');
	let error = $state('');
	let busy = $state(false);
	let savingId = $state('');

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
		'curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickinbox/main/scripts/install.sh | sh';

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
				keyError = body.error ?? t('settings.couldNotCreateKey');
				return;
			}
			tokens = [body.tokenMeta, ...tokens.filter((token) => token.id !== body.tokenMeta.id)];
			revealed = { summary: body.tokenMeta, token: body.token };
			copied = false;
			keyName = '';
		} catch {
			keyError = t('common.networkError');
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
		if (!confirm(t('settings.revokeConfirm'))) return;
		const res = await fetch(`/api/apikeys/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
				keyError = body.error ?? t('settings.couldNotRevokeKey');
			return;
		}
		tokens = body.tokens;
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleDateString(intlLocale($page.data.locale), {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
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
				body: JSON.stringify({ domainId, localPart, label: displayName.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('settings.couldNotAddAddress');
				return;
			}
			edited = [...addresses, body.address];
			localPart = '';
			displayName = '';
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}

	async function saveLabel(id: string, label: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.label ?? '') === label.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: label.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('settings.couldNotSaveName');
				return;
			}
			edited = body.addresses;
		} catch {
			error = t('common.networkError');
		} finally {
			savingId = '';
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

	async function saveMailboxSignature(id: string, value: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.signature ?? '') === value.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature: value })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('settings.couldNotSaveMailboxSignature');
				return;
			}
			edited = body.addresses;
		} catch {
			error = t('common.networkError');
		} finally {
			savingId = '';
		}
	}

	async function remove(id: string) {
		const res = await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
				error = body.error ?? t('settings.couldNotRemoveAddress');
			return;
		}
		edited = body.addresses;
	}

	// ---- Connected devices --------------------------------------------------

	let devices = $state<DeviceSession[]>(untrack(() => data.devices ?? []));
	let pairingPanelOpen = $state(false);
	let pairingCode = $state('');
	let pairingExpiresAt = $state('');
	let pairingSecondsRemaining = $state(0);
	let pairingBusy = $state(false);
	let pairError = $state('');
	let deviceError = $state('');
	let pairCopied = $state(false);
	let revokingId = $state('');
	let qrCanvas: HTMLCanvasElement | undefined = $state();
	let pairingTimer: ReturnType<typeof setInterval> | undefined;
	let pairingRequest: AbortController | undefined;
	let pairingGeneration = 0;

	const pairingCountdown = $derived(
		`${Math.floor(pairingSecondsRemaining / 60)}:${String(pairingSecondsRemaining % 60).padStart(2, '0')}`
	);

	function stopPairingTimer() {
		if (pairingTimer) clearInterval(pairingTimer);
		pairingTimer = undefined;
	}

	function updatePairingCountdown() {
		if (!pairingPanelOpen || !pairingExpiresAt || document.visibilityState === 'hidden') return;

		const expiresAt = Date.parse(pairingExpiresAt);
		if (!Number.isFinite(expiresAt)) {
			stopPairingTimer();
			pairingCode = '';
			pairError = t('settings.invalidPairingExpiry');
			return;
		}

		pairingSecondsRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
		if (pairingSecondsRemaining === 0) {
			pairingCode = '';
			// If QR rendering is still finishing, leave the timer running so the
			// next tick refreshes after that request releases its busy state.
			if (!pairingBusy) {
				stopPairingTimer();
				void requestPairingCode();
			}
		}
	}

	function startPairingTimer() {
		stopPairingTimer();
		updatePairingCountdown();
		if (pairingCode && pairingSecondsRemaining > 0) {
			pairingTimer = setInterval(updatePairingCountdown, 1_000);
		}
	}

	async function requestPairingCode() {
		if (!pairingPanelOpen || pairingBusy) return;

		pairingBusy = true;
		pairError = '';
		pairCopied = false;
		const generation = pairingGeneration;
		const controller = new AbortController();
		pairingRequest = controller;

		try {
			const res = await fetch('/api/auth/pair-codes', {
				method: 'POST',
				signal: controller.signal
			});
			const body = await res.json();
			if (!pairingPanelOpen || generation !== pairingGeneration) return;
			if (!res.ok) {
				pairError = body.error ?? t('settings.couldNotCreatePairing');
				return;
			}

			pairingCode = body.code;
			pairingExpiresAt = body.expiresAt;
			startPairingTimer();
			await tick();
			if (!pairingPanelOpen || generation !== pairingGeneration || !qrCanvas) return;

			// The QR carries the server origin so the app knows which deployment
			// to talk to, plus the one-time code.
			const payload = JSON.stringify({ version: 1, origin: window.location.origin, code: body.code });
			try {
				const { default: QRCode } = await import('qrcode');
				await QRCode.toCanvas(qrCanvas, payload, { width: 200, margin: 1 });
			} catch {
				pairError = t('settings.couldNotDrawQr');
			}
		} catch (requestError) {
			if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
			if (pairingPanelOpen && generation === pairingGeneration) {
				pairError = t('settings.pairingNetwork');
			}
		} finally {
			if (pairingRequest === controller) {
				pairingRequest = undefined;
				pairingBusy = false;
			}
		}
	}

	function openPairingPanel() {
		pairingPanelOpen = true;
		pairingCode = '';
		pairingExpiresAt = '';
		pairingSecondsRemaining = 0;
		void requestPairingCode();
	}

	function closePairingPanel() {
		pairingPanelOpen = false;
		pairingGeneration += 1;
		pairingRequest?.abort();
		pairingRequest = undefined;
		pairingBusy = false;
		stopPairingTimer();
		pairingCode = '';
		pairingExpiresAt = '';
		pairingSecondsRemaining = 0;
		pairError = '';
		pairCopied = false;
	}

	$effect(() => {
		function handleVisibilityChange() {
			if (!pairingPanelOpen) return;
			if (document.visibilityState === 'hidden') {
				stopPairingTimer();
				return;
			}

			const expiry = Date.parse(pairingExpiresAt);
			if (!pairingCode || !Number.isFinite(expiry) || expiry <= Date.now()) {
				pairingCode = '';
				void requestPairingCode();
			} else {
				startPairingTimer();
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			pairingGeneration += 1;
			pairingRequest?.abort();
			stopPairingTimer();
		};
	});

	async function revokeDevice(id: string) {
		const device = devices.find((candidate) => candidate.id === id);
		if (!device || device.is_current) return;
		const name = device.device_name ?? t('settings.thisBrowserSession');
		if (!confirm(t('settings.disconnectDevice', { name }))) return;
		revokingId = id;
		deviceError = '';

		try {
			const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				deviceError = t('settings.couldNotDisconnect');
				return;
			}
			devices = devices.filter((device) => device.id !== id);
		} catch {
			deviceError = t('settings.disconnectNetwork');
		} finally {
			revokingId = '';
		}
	}

	function platformLabel(device: DeviceSession) {
		if (device.device_platform === 'ios') return t('settings.ios');
		if (device.device_platform === 'android') return t('settings.android');
		return t('settings.webBrowser');
	}

	async function copyPairingCode() {
		try {
			await navigator.clipboard.writeText(pairingCode);
			pairCopied = true;
		} catch {
			pairError = t('settings.couldNotCopyCode');
		}
	}
</script>

<svelte:head>
	<title>{t('settings.title', { app: APP_NAME })}</title>
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="settings-page" class:zero={zeroChrome}>
	{#if showAll && !zeroChrome}
		<StackHeader title={t('nav.settings')} back={false} />
	{:else}
		<h1 class="settings-section-title">
			{sectionTitle(section)}
		</h1>
	{/if}

	{#if show('appearance')}
	<section class="surface-lg card">
		<h2><Icon name="contrast-2-line" size={18} /> {t('nav.appearance')}</h2>

		<div class="theme-options" role="radiogroup" aria-label={t('settings.theme')}>
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
						{themeLabel(option.value)}
					</span>
					{#if theme === option.value}
						<span class="theme-check"><Icon name="check-line" size={14} /></span>
					{/if}
				</button>
			{/each}
		</div>

		<p class="card-hint" style="margin-top: 1.25rem;">{t('settings.interface')}</p>
		<UiThemePicker />
		<p class="card-hint" style="margin-top: 1.25rem;">{t('settings.language')}</p>
		<p class="card-hint">{t('settings.languageHint')}</p>
		<LocalePicker />
	</section>
	{/if}

	{#if showAll || section === 'notifications'}
	<InstallApp />

	<DesktopNotifications configured={data.push.configured} publicKey={data.push.publicKey} />
	{/if}

	{#if show('general')}
	<section class="surface-lg card">
		<h2><Icon name="pencil-line" size={18} /> {t('settings.signature')}</h2>
		<p class="card-hint">{t('settings.signatureHint')}</p>

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
					{signatureBusy ? t('common.saving') : t('common.save')}
				</button>
			</div>

			{#if signatureError}<p class="error">{signatureError}</p>{/if}
			{#if signatureSaved}<p class="saved">{t('common.saved')}</p>{/if}
		</form>
	</section>
	{/if}

	{#if show('connections')}
	<section class="surface-lg card">
		<h2><Icon name="at-line" size={18} /> {t('settings.addresses')}</h2>
		<p class="card-hint">
			{t('settings.addressesHint')}
		</p>

		<ul class="address-list">
			{#each addresses as address (address.id)}
				<li class="address-row">
					<div class="address-head">
						<div class="min-w-0 flex-1">
							<input
								type="text"
								class="name-input"
								value={address.label ?? ''}
								placeholder={t('settings.fromName')}
								aria-label={t('settings.fromNameFor', { address: address.address })}
								disabled={savingId === address.id}
								onchange={(event) => saveLabel(address.id, event.currentTarget.value)}
							/>
							<p class="address-domain">{address.address}</p>
						</div>

						{#if address.is_default}
							<span class="badge">{t('common.default')}</span>
						{:else}
							<button type="button" class="btn-ghost text-xs" onclick={() => makeDefault(address.id)}>
								{t('settings.makeDefault')}
							</button>
						{/if}

						{#if addresses.length > 1}
							<button
								type="button"
								class="icon-btn"
								aria-label={t('settings.removeAddress', { address: address.address })}
								onclick={() => remove(address.id)}
							>
								<Icon name="delete-bin-line" size={15} />
							</button>
						{/if}
					</div>
					<textarea
						class="mailbox-signature"
						rows="2"
						maxlength={MAX_EMAIL_SIGNATURE_LENGTH}
						value={address.signature ?? ''}
						placeholder={t('settings.mailboxSignature')}
						aria-label={t('settings.mailboxSignature')}
						disabled={savingId === address.id}
						onchange={(event) => saveMailboxSignature(address.id, event.currentTarget.value)}
					></textarea>
				</li>
			{/each}
		</ul>

		<form class="add-form" onsubmit={addAddress}>
			<div class="add-field">
				<label class="field-title" for="new-display-name">{t('settings.fromName')}</label>
				<input
					id="new-display-name"
					type="text"
					bind:value={displayName}
					placeholder="Support"
					class="name-add-input"
					autocomplete="off"
				/>
				<AddressField
					bind:localPart
					bind:domainId
					domains={data.domains}
					placeholder="another"
					label={t('settings.addressLabel')}
				/>
			</div>
			<button type="submit" class="btn-primary" disabled={busy || !localPart.trim()}>
				{busy ? t('common.adding') : t('common.add')}
			</button>
		</form>

		{#if selectedDomain && !selectedDomain.receiving_enabled}
			<p class="hint">
				<Icon name="information-line" size={14} />
				{t('settings.canSendNotReceive', { domain: selectedDomain.name })}
			</p>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
	</section>

	<section class="surface-lg card">
		<h2><Icon name="global-line" size={18} /> {t('settings.connectedDomains')}</h2>
		<ul class="domain-list">
			{#each data.domains as domain (domain.id)}
				<li class="domain-row">
					<span class="domain-name">{domain.name}</span>
					<span class="caps">
						<span class="chip" class:chip-on={domain.sending_enabled}>{t('settings.send')}</span>
						<span class="chip" class:chip-on={domain.receiving_enabled}>{t('settings.receive')}</span>
						<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
					</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="surface-lg card">
		<div class="card-head">
			<h2><Icon name="key-2-line" size={18} /> {t('settings.apiKeys')}</h2>
			<button type="button" class="btn-primary" onclick={openCreate}>
				<Icon name="add-line" size={15} />
				{t('settings.new')}
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
							aria-label={t('settings.revokeKey', { name: token.name })}
							onclick={() => revokeKey(token.id)}
						>
							<Icon name="delete-bin-line" size={15} />
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{t('settings.noKeys')}</p>
		{/if}

		{#if keyError && !creating}<p class="error">{keyError}</p>{/if}

		<div class="install-row">
			<code>{installCommand}</code>
			<button type="button" class="icon-btn" aria-label={t('settings.copyInstall')} onclick={copyInstall}>
				<Icon name={installCopied ? 'check-line' : 'file-copy-line'} size={15} />
			</button>
		</div>
	</section>

	<section class="surface-lg card">
		<h2><Icon name="smartphone-line" size={18} /> {t('settings.devices')}</h2>
		<p class="card-hint">
			{t('settings.devicesHint')}
		</p>

		{#if devices.length > 0}
			<ul class="device-list">
				{#each devices as device (device.id)}
					<li class="device-row">
						<div class="min-w-0 flex-1">
							<p class="device-name">
								{device.device_name ?? t('settings.webBrowser')}
								{#if device.is_current}<span class="badge">{t('settings.thisDevice')}</span>{/if}
							</p>
							<p class="device-meta">
								{platformLabel(device)} · {device.last_seen_at ? formatDeviceActivity(device.last_seen_at, $page.data.locale) : t('settings.signedIn')}
								· {t('settings.addedOn', { date: new Date(device.created_at).toLocaleDateString(intlLocale($page.data.locale)) })}
							</p>
						</div>
						{#if !device.is_current}
							<button
								type="button"
								class="btn-ghost text-xs"
								disabled={revokingId === device.id}
								onclick={() => revokeDevice(device.id)}
							>
								{revokingId === device.id ? t('common.disconnecting') : t('common.disconnect')}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">{t('settings.noSessions')}</p>
		{/if}

		{#if pairingPanelOpen}
			<div class="pair-panel" aria-busy={pairingBusy}>
				<div class="pair-heading">
					<p class="pair-title">{t('settings.scanWithApp', { app: APP_NAME })}</p>
					<button type="button" class="icon-btn" aria-label={t('settings.closePairing')} onclick={closePairingPanel}>
						<Icon name="close-line" size={15} />
					</button>
				</div>

				{#if pairingCode}
					<canvas bind:this={qrCanvas} aria-hidden="true">
						{t('settings.pairingCanvas', { app: APP_NAME })}
					</canvas>
					<div class="pair-code">
						<span>{t('settings.orEnterCode')} <code>{pairingCode}</code></span>
						<button type="button" class="btn-ghost text-xs" onclick={copyPairingCode}>{t('settings.copyCode')}</button>
					</div>
					{#if pairCopied}<p class="pair-copied" role="status">{t('settings.codeCopied')}</p>{/if}
					<p
						class="pair-expiry"
						role="timer"
						aria-label={t('settings.pairingRefreshes', { seconds: pairingSecondsRemaining })}
					>
						{t('settings.refreshesIn', { countdown: pairingCountdown })}
					</p>
				{:else if pairingBusy}
					<p class="pair-loading" role="status">{t('settings.creatingPairing')}</p>
				{:else}
					<p class="pair-loading">{t('settings.pairingUnavailable')}</p>
					<button type="button" class="btn-ghost text-xs" onclick={requestPairingCode}>
						{t('common.tryAgain')}
					</button>
				{/if}
			</div>
		{:else}
			<button type="button" class="btn-primary pair-btn" onclick={openPairingPanel}>
				{t('settings.connectMobile')}
			</button>
		{/if}

		{#if pairError}<p class="error" role="status">{pairError}</p>{/if}
		{#if deviceError}<p class="error" role="alert">{deviceError}</p>{/if}
	</section>
	{/if}

	{#if section === 'shortcuts'}
		<section class="surface-lg card">
			<h2><Icon name="keyboard-line" size={18} /> {t('nav.shortcuts')}</h2>
			<p class="card-hint">{t('settings.shortcutsHint')}</p>
			<ul class="shortcut-list">
				{#each SHORTCUTS as row (row.label)}
					<li>
						<span>{row.label}</span>
						<kbd>{row.keys}</kbd>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
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
			aria-label={revealed ? t('settings.copyApiKey') : t('settings.newApiKey')}
			tabindex="-1"
		>
			<div class="modal-head">
				<h3>
					<Icon name="key-2-line" size={16} />
					{revealed ? t('settings.copyThisKey') : t('settings.newApiKey')}
				</h3>
				<button type="button" class="icon-btn" aria-label={t('common.close')} onclick={closeCreate}>
					<Icon name="close-line" size={16} />
				</button>
			</div>

			{#if revealed}
				<p class="modal-note">{t('settings.shownOnce')}</p>
				<pre class="token-box">{revealed.token}</pre>
				<div class="modal-actions">
					<button type="button" class="btn-primary" onclick={copyKey}>
						<Icon name={copied ? 'check-line' : 'file-copy-line'} size={15} />
						{copied ? t('common.copied') : t('common.copy')}
					</button>
					<button type="button" class="btn-ghost" onclick={closeCreate}>{t('common.done')}</button>
				</div>
			{:else}
				<form class="key-form" onsubmit={createKey}>
					<label class="sr-only" for="apikey-name">{t('settings.keyName')}</label>
					<input
						id="apikey-name"
						class="text-input"
						placeholder={t('settings.name')}
						value={keyName}
						autofocus
						oninput={(event) => (keyName = event.currentTarget.value)}
					/>

					<div class="scope-row">
						<Check label={t('settings.sendMail')} caption="send" checked={sendScope} onchange={(next) => (sendScope = next)} />
						<Check label={t('settings.readMail')} caption="read" checked={readScope} onchange={(next) => (readScope = next)} />
						{#if data.isAdmin}
							<Check
								label={t('nav.admin')}
								caption="admin"
								checked={adminScope}
								onchange={(next) => (adminScope = next)}
							/>
						{/if}
					</div>

					{#if keyError}<p class="error">{keyError}</p>{/if}

					<div class="modal-actions">
						<button type="button" class="btn-ghost" onclick={closeCreate}>{t('common.cancel')}</button>
						<button type="submit" class="btn-primary" disabled={keyBusy || !canCreateKey}>
							{keyBusy ? t('common.creating') : t('common.create')}
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

	.settings-page :global(.stack-header) {
		margin-bottom: 0;
	}

	.settings-section-title {
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.shortcut-list {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.shortcut-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0;
		font-size: 0.875rem;
		border-bottom: 1px solid var(--color-line, var(--z-border, #eee));
	}

	.shortcut-list kbd {
		font-family: inherit;
		font-size: 0.75rem;
		padding: 0.15rem 0.4rem;
		border-radius: 0.35rem;
		background: var(--color-surface-muted, var(--z-hover, #f5f5f5));
		color: var(--color-muted, var(--z-muted, #8c8c8c));
	}

	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	@media (max-width: 900px) {
		.settings-page {
			max-width: none;
			padding-bottom: 1.5rem;
		}

		.card {
			padding: 1.25rem 1rem;
		}
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

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.signature-form {
		margin-top: 1rem;
	}

	.device-list {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.device-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.device-name {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		font-size: 0.875rem;
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.device-meta {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.pair-panel {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.pair-title {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.pair-heading {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.pair-panel canvas {
		max-width: 100%;
		height: auto;
		align-self: center;
		background: #fff;
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.pair-code code {
		font-size: 0.8125rem;
		user-select: all;
		overflow-wrap: anywhere;
	}

	.pair-code {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.pair-copied {
		font-size: 0.75rem;
		color: var(--tone-good-fg);
	}

	.pair-expiry,
	.pair-code,
	.pair-loading {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.pair-btn {
		margin-top: 1rem;
	}

	@media (max-width: 30rem) {
		.device-row {
			align-items: flex-start;
			flex-wrap: wrap;
		}

		.device-row > button {
			min-height: 2.75rem;
		}

		.pair-code {
			align-items: flex-start;
			flex-direction: column;
		}
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
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		padding: 0.75rem 0;
	}

	.address-row + .address-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.address-head {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.name-input {
		width: 100%;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.name-input::placeholder {
		color: var(--color-muted);
		font-weight: 400;
	}

	.mailbox-signature {
		width: 100%;
		padding: 0.5rem 0.75rem;
		resize: vertical;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.mailbox-signature:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.mailbox-signature::placeholder {
		color: var(--color-muted);
	}

	.address-domain {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.name-add-input {
		width: 100%;
		margin: 0.5rem 0 0.875rem;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.name-add-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
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

	@media (max-width: 900px) {
		.settings-page {
			max-width: none;
		}

		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}

		.theme-options {
			gap: 0.5rem;
		}
	}

	.zero :global(.surface-lg),
	.zero :global(.surface-lg.card) {
		background: transparent !important;
		box-shadow: none !important;
		border-color: transparent !important;
		border-radius: 0 !important;
	}

	.zero :global(section.surface-lg) {
		padding: 1.75rem 0 0 !important;
		margin-top: 0 !important;
	}

	.zero :global(section.surface-lg + section.surface-lg) {
		border-top: 1px solid var(--color-line, var(--z-border, #252525)) !important;
		margin-top: 1.25rem !important;
	}

	.zero :global(.btn-primary) {
		box-shadow: none;
		border-radius: 0.5rem;
	}

	.zero :global(.device-row),
	.zero :global(.pair-panel) {
		box-shadow: none !important;
	}
</style>
