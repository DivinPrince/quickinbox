<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { requestSkipViewTransition } from '$lib/app-chrome';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import type { OutboundAttachmentInput } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const addresses = $derived(data.addresses);
	const defaultAddressId = $derived(
		addresses.find((address) => address.is_default)?.id ?? addresses[0]?.id ?? ''
	);

	// Falls back to the default identity until the composer picks another.
	let chosenAddressId = $state('');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	// The draft seeds the form once; after that the fields own their values.
	const draft = untrack(() => data.draft);

	let draftId = $state<string | null>(draft?.id ?? null);
	let to = $state(draft?.to_addr ?? '');
	let cc = $state(draft?.cc_addr ?? '');
	let bcc = $state(draft?.bcc_addr ?? '');
	let subject = $state(draft?.subject ?? '');
	let html = $state(draft?.body_html || draft?.body_text || '');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let showCopies = $state(Boolean(draft?.cc_addr || draft?.bcc_addr));
	let error = $state('');
	let sending = $state(false);
	let savingDraft = $state(false);
	let savedAt = $state('');

	const hasDraftText = $derived(Boolean(to.trim() || subject.trim() || !isHtmlEmpty(html)));

	async function saveDraft(): Promise<boolean> {
		if (savingDraft || !hasDraftText) return false;
		savingDraft = true;
		error = '';

		try {
			const res = await fetch('/api/drafts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: draftId,
					fromAddressId,
					to,
					cc: cc.trim() || undefined,
					bcc: bcc.trim() || undefined,
					subject,
					html,
					text: isHtmlEmpty(html) ? '' : htmlToPlainText(html)
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('compose.couldNotSaveDraft');
				return false;
			}
			draftId = body.id;
			savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
			return true;
		} catch {
			error = t('common.networkError');
			return false;
		} finally {
			savingDraft = false;
		}
	}

	async function closeComposer() {
		if (hasDraftText && !(await saveDraft())) return;
		if (attachments.length > 0) {
			error = t('compose.attachmentsNotSaved');
			return;
		}
		requestSkipViewTransition();
		await goto(draftId ? '/drafts' : '/inbox');
	}

	async function discardDraft() {
		if (!draftId) {
			window.location.href = '/inbox';
			return;
		}
		await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
		window.location.href = '/drafts';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (isHtmlEmpty(html)) {
			error = t('compose.writeMessage');
			return;
		}

		sending = true;
		error = '';

		try {
			const res = await fetch('/api/mail', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					draftId: draftId ?? undefined,
					fromAddressId,
					to,
					cc: cc.trim() || undefined,
					bcc: bcc.trim() || undefined,
					subject,
					html,
					text: htmlToPlainText(html),
					attachments
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('compose.failedToSend');
				return;
			}
			window.location.href = '/sent';
		} catch {
			error = t('common.networkError');
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{draftId ? t('compose.draftTitle', { app: APP_NAME }) : t('compose.title', { app: APP_NAME })}</title>
</svelte:head>

<form class="compose-page" onsubmit={submit}>
	<header class="compose-mobile-bar">
		<button
			type="button"
			class="icon-btn"
			aria-label={t('common.close')}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={closeComposer}
		>
			<Icon name="close-line" size={22} />
		</button>
		<div class="compose-heading">
			<h1 class="page-title">{draftId ? t('compose.draft') : t('nav.compose')}</h1>
			{#if savedAt}<span class="saved">{t('common.savedAt', { time: savedAt })}</span>{/if}
		</div>
		<button type="submit" class="btn-primary" disabled={sending}>
			{sending ? t('common.sending') : t('common.send')}
		</button>
	</header>

	<header class="compose-header">
		<div class="compose-heading">
			<h1 class="page-title">{draftId ? t('compose.draft') : t('nav.compose')}</h1>
			{#if savedAt}<span class="saved">{t('common.savedAt', { time: savedAt })}</span>{/if}
		</div>

		<div class="compose-actions">
			<button
				type="button"
				class="btn-ghost"
				onclick={() => (showCopies = !showCopies)}
				aria-expanded={showCopies}
			>
				{t('compose.ccBcc')}
			</button>
			<button type="button" class="btn-ghost" disabled={savingDraft || !hasDraftText} onclick={saveDraft}>
				<Icon name="save-line" size={15} />
				{savingDraft ? t('common.saving') : t('compose.saveDraft')}
			</button>
			{#if draftId}
				<button type="button" class="btn-ghost" onclick={discardDraft} aria-label={t('compose.discardDraft')}>
					<Icon name="delete-bin-line" size={15} />
				</button>
			{/if}
			<button type="submit" class="btn-primary" disabled={sending}>
				<Icon name="send-plane-2-fill" size={16} />
				{sending ? t('common.sending') : t('common.send')}
			</button>
		</div>
	</header>

	<div class="surface compose-fields">
		<!-- With several domains connected, choosing the identity matters. -->
		<div class="field-row">
			<span class="field-label">{t('compose.from')}</span>
			{#if addresses.length > 1}
				<select
					value={fromAddressId}
					onchange={(event) => (chosenAddressId = event.currentTarget.value)}
					class="field-input"
					aria-label={t('compose.sendFrom')}
				>
					{#each addresses as address (address.id)}
						<option value={address.id}>
							{address.label ? `${address.label} · ${address.address}` : address.address}
						</option>
					{/each}
				</select>
			{:else}
				<span class="field-static">
					{addresses[0]?.label
						? `${addresses[0].label} · ${addresses[0].address}`
						: (addresses[0]?.address ?? '—')}
				</span>
			{/if}
		</div>

		<div class="field-row">
			<span class="field-label">{t('compose.to')}</span>
			<input
				id="to"
				type="text"
				inputmode="email"
				autocomplete="email"
				bind:value={to}
				required
				placeholder={t('compose.recipientPlaceholder')}
				class="field-input"
			/>
			<button
				type="button"
				class="copies-toggle"
				onclick={() => (showCopies = !showCopies)}
				aria-expanded={showCopies}
			>
				{t('compose.ccBcc')}
			</button>
		</div>

		{#if showCopies}
			<div class="field-row">
				<span class="field-label">{t('compose.cc')}</span>
				<input type="text" bind:value={cc} placeholder={t('compose.commaSeparated')} class="field-input" />
			</div>
			<div class="field-row">
				<span class="field-label">{t('compose.bcc')}</span>
				<input type="text" bind:value={bcc} placeholder={t('compose.commaSeparated')} class="field-input" />
			</div>
		{/if}

		<div class="field-row">
			<span class="field-label">{t('compose.subject')}</span>
			<input
				id="subject"
				type="text"
				bind:value={subject}
				required
				placeholder={t('compose.subject')}
				class="field-input"
			/>
		</div>
	</div>

	{#if attachments.length}
		<div class="compose-chips">
			<AttachmentPicker bind:attachments mode="chips" />
		</div>
	{/if}

	<div class="compose-editor">
		<RichTextEditor bind:html fill minHeight={320}>
			{#snippet toolbarEnd()}
				<AttachmentPicker bind:attachments mode="button" />
				<button
					type="button"
					class="icon-btn"
					disabled={savingDraft || !hasDraftText}
					aria-label={savingDraft ? t('common.saving') : t('compose.saveDraft')}
					onclick={saveDraft}
				>
					<Icon name="save-line" size={18} />
				</button>
				{#if draftId}
					<button
						type="button"
						class="icon-btn danger"
						aria-label={t('compose.discardDraft')}
						onclick={discardDraft}
					>
						<Icon name="delete-bin-line" size={18} />
					</button>
				{/if}
			{/snippet}
		</RichTextEditor>
	</div>

	{#if error}
		<p class="compose-error">{error}</p>
	{/if}

	<div class="compose-desktop-foot">
		<AttachmentPicker bind:attachments />
	</div>
</form>

<style>
	.compose-page {
		width: 100%;
	}

	.compose-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.compose-heading {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}

	.saved {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.compose-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.compose-fields {
		overflow: hidden;
	}

	.field-static {
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
	}

	.copies-toggle {
		display: none;
	}

	.compose-editor {
		margin-top: 1rem;
	}

	.compose-error {
		margin-top: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.compose-mobile-bar {
		display: none;
	}

	.compose-chips {
		display: none;
	}

	.compose-desktop-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	@media (max-width: 900px) {
		.compose-page {
			display: flex;
			flex-direction: column;
			flex: 1;
			width: 100%;
			min-width: 0;
			min-height: 0;
			height: 100%;
			background: var(--color-surface);
		}

		.compose-header {
			display: none;
		}

		.compose-mobile-bar {
			position: sticky;
			top: 0;
			z-index: 20;
			display: flex;
			align-items: center;
			gap: 0.375rem;
			flex-shrink: 0;
			min-height: calc(3.25rem + env(safe-area-inset-top));
			padding: env(safe-area-inset-top) 0.375rem 0.25rem;
			background: var(--color-surface);
			box-shadow: inset 0 -1px 0 var(--color-line);
		}

		.compose-mobile-bar .compose-heading {
			flex: 1;
			min-width: 0;
			flex-direction: column;
			align-items: center;
			gap: 0;
		}

		.compose-mobile-bar .page-title {
			font-size: 1.0625rem;
		}

		.compose-mobile-bar .btn-primary {
			min-width: 4.5rem;
		}

		.compose-fields {
			flex-shrink: 0;
			border-radius: 0;
			box-shadow: none;
			background: var(--color-surface);
		}

		.compose-fields :global(.field-row) {
			min-height: var(--touch-target);
			padding: 0 1rem;
		}

		.copies-toggle {
			display: flex;
			align-items: center;
			flex-shrink: 0;
			min-height: var(--touch-target);
			padding: 0 0.25rem 0 0.5rem;
			font-size: 0.8125rem;
			font-weight: 500;
			color: var(--color-accent-text);
		}

		.compose-editor {
			display: flex;
			flex: 1;
			flex-direction: column;
			min-height: 0;
			margin: 0;
		}

		.compose-error {
			margin: 0;
			padding: 0 1rem 0.5rem;
		}

		.compose-chips {
			display: block;
			flex-shrink: 0;
			padding: 0.375rem 1rem 0.5rem;
		}

		.compose-desktop-foot {
			display: none;
		}

		.compose-editor :global(.icon-btn.danger) {
			color: var(--color-danger);
		}
	}
</style>
