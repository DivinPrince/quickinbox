<script lang="ts">
	import { tick, untrack } from 'svelte';
	import DraftAutosave from '$lib/components/DraftAutosave.svelte';
	import { createMailSender } from '$lib/mail/send';
	const sendMail = createMailSender();
	import { invalidateAll } from '$app/navigation';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import type { MailAddress, OutboundAttachmentInput } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import WindowIcon from '$lib/components/Icon.svelte';
	import ComposerActions from './ComposerActions.svelte';
	import { t } from '$lib/i18n';

	let {
		addresses,
		draftId = null,
		onClose
	}: {
		addresses: MailAddress[];
		draftId?: string | null;
		onClose: () => void;
	} = $props();

	const defaultAddressId = $derived(
		addresses.find((address) => address.is_default)?.id ?? addresses[0]?.id ?? ''
	);
	let chosenAddressId = $state('');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	let activeDraft = $state(untrack(() => draftId ?? crypto.randomUUID()));
	let loaded = $state(!untrack(() => draftId));
	let revision = $state(0);
	let autosave: DraftAutosave | undefined = $state();
	let to = $state('');
	let cc = $state('');
	let bcc = $state('');
	let subject = $state('');
	let html = $state('');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let showCc = $state(false);
	let showBcc = $state(false);
	let error = $state('');
	let sending = $state(false);
	let imagesLoading = $state(false);
	let savingDraft = $state(false);
	let minimized = $state(false);
	let expanded = $state(false);
	let recipientInput: HTMLInputElement | undefined = $state();
	const composerId = $props.id();

	// Keep the editor mounted so window controls preserve its contents and undo history.
	export async function restore() {
		minimized = false;
		await tick();
		recipientInput?.focus();
	}

	$effect(() => {
		if (loaded) recipientInput?.focus();
	});

	$effect(() => {
		const id = draftId;
		if (!id || (id === activeDraft && loaded)) return;
		minimized = false;
		error = '';
		loaded = false;
		void fetch(`/api/drafts/${id}`)
			.then(async (response) => {
				const draft = (await response.json()) as {
					id?: string;
					to_addr?: string;
					cc_addr?: string | null;
					bcc_addr?: string | null;
					subject?: string;
					body_html?: string | null;
					body_text?: string | null;
					address_id?: string | null;
					draft_revision?: number;
					attachments?: OutboundAttachmentInput[];
					error?: string;
				};
				if (!response.ok || !draft.id) {
					error = draft.error ?? t('compose.couldNotLoadDraft');
					return;
				}
				activeDraft = draft.id;
				to = draft.to_addr ?? '';
				cc = draft.cc_addr ?? '';
				bcc = draft.bcc_addr ?? '';
				subject = draft.subject ?? '';
				html = draft.body_html || draft.body_text || '';
				if (draft.address_id) chosenAddressId = draft.address_id;
				showCc = Boolean(draft.cc_addr);
				showBcc = Boolean(draft.bcc_addr);
				attachments = draft.attachments ?? [];
				revision = draft.draft_revision ?? 0;
				loaded = true;
			})
			.catch(() => {
				error = t('compose.couldNotLoadDraft');
			});
	});

	const hasDraftText = $derived(Boolean(to.trim() || cc.trim() || bcc.trim() || subject.trim() || !isHtmlEmpty(html) || attachments.length));
	const draftPayload = $derived({ fromAddressId, to, cc, bcc, subject, html, text: typeof window === 'undefined' || isHtmlEmpty(html) ? '' : htmlToPlainText(html), attachments });
	async function saveDraft(): Promise<boolean> {
		if (imagesLoading) return false;
		savingDraft = true;
		try { return await autosave?.flush() ?? false; } finally { savingDraft = false; }
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (isHtmlEmpty(html)) {
			error = t('compose.writeMessage');
			return;
		}
		if (!loaded || sending || imagesLoading || !(await saveDraft())) return;
		sending = true;
		error = '';
		try {
			const response = await sendMail('/api/mail', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					draftId: activeDraft ?? undefined,
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
			const body = (await response.json()) as { id?: string; error?: string };
			if (!response.ok) {
				error = body.error ?? t('compose.failedToSend');
				return;
			}
			autosave?.finish();
			await invalidateAll();
			onClose();
		} catch {
			error = t('common.networkError');
		} finally {
			sending = false;
		}
	}

	async function close() {
		if (sending || imagesLoading) return;
		if (!loaded) { onClose(); return; }
		if (!(await saveDraft())) return;
		autosave?.finish();
		onClose();
	}

	function onKey(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			(event.target as HTMLElement | null)?.closest('form')?.requestSubmit();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			void close();
		}
	}
</script>

<div
	class="z-compose-window"
	class:minimized
	class:expanded={expanded && !minimized}
	onkeydown={onKey}
	role="dialog"
	aria-label={t('compose.newMessage')}
	tabindex="-1"
>
	<header class="z-compose-header">
		<button type="button" class="z-compose-title" aria-expanded={!minimized} aria-controls={composerId} onclick={() => (minimized = !minimized)}>
			{subject.trim() || t('compose.newMessage')}
		</button>
		<div class="z-compose-controls">
			<Tooltip text={t(minimized ? 'compose.restore' : 'compose.minimize')}>
				<button type="button" class="z-icon-btn" aria-label={t(minimized ? 'compose.restore' : 'compose.minimize')} onclick={() => (minimized = !minimized)}>
					<WindowIcon name={minimized ? 'arrow-up-s-line' : 'subtract-line'} size={16} />
				</button>
			</Tooltip>
			<div class="z-compose-expand">
				<Tooltip text={t(expanded ? 'compose.exitFullScreen' : 'compose.fullScreen')}>
					<button type="button" class="z-icon-btn" aria-label={t(expanded ? 'compose.exitFullScreen' : 'compose.fullScreen')} onclick={() => { expanded = !expanded; minimized = false; }}>
						<WindowIcon name={expanded ? 'collapse-diagonal-line' : 'expand-diagonal-line'} size={16} />
					</button>
				</Tooltip>
			</div>
			<Tooltip text={t('common.close')}>
				<button type="button" class="z-icon-btn" aria-label={t('common.close')} onclick={close} disabled={sending || savingDraft || imagesLoading}>
					<Icon name="X" size={14} />
				</button>
			</Tooltip>
		</div>
	</header>

	<form id={composerId} class="z-composer" hidden={minimized} onsubmit={send} inert={!loaded || sending}>
		<div class="z-composer-fields">
			<div class="z-composer-row">
				<span class="z-composer-label">{t('compose.toColon')}</span>
				<input class="z-composer-input" bind:this={recipientInput} bind:value={to} aria-label={t('compose.to')} required placeholder={t('compose.emailPlaceholder')} />
				<div class="z-composer-row-actions">
					<button type="button" class="z-composer-link" onclick={() => (showCc = !showCc)}>{t('compose.cc')}</button>
					<button type="button" class="z-composer-link" onclick={() => (showBcc = !showBcc)}>{t('compose.bcc')}</button>
				</div>
			</div>
			{#if showCc}
				<div class="z-composer-row">
					<span class="z-composer-label">{t('compose.ccColon')}</span>
					<input class="z-composer-input" bind:value={cc} aria-label={t('compose.cc')} placeholder={t('compose.ccPlaceholder')} />
				</div>
			{/if}
			{#if showBcc}
				<div class="z-composer-row">
					<span class="z-composer-label">{t('compose.bccColon')}</span>
					<input class="z-composer-input" bind:value={bcc} aria-label={t('compose.bcc')} placeholder={t('compose.bccPlaceholder')} />
				</div>
			{/if}
			<div class="z-composer-row">
					<span class="z-composer-label">{t('compose.subjectColon')}</span>
					<input class="z-composer-input" bind:value={subject} aria-label={t('compose.subject')} required placeholder={t('compose.subject')} />
			</div>
			{#if addresses.length > 1}
				<div class="z-composer-row">
					<span class="z-composer-label">{t('compose.fromColon')}</span>
					<select
						class="z-composer-input"
						aria-label={t('compose.sendFrom')}
						value={fromAddressId}
						onchange={(event) => (chosenAddressId = event.currentTarget.value)}
					>
						{#each addresses as address (address.id)}
							<option value={address.id}>
								{address.label ? `${address.label} · ${address.address}` : address.address}
							</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>

		<div class="z-composer-body">
			<RichTextEditor bind:html bind:attachments bind:imagesLoading allowImages embedded minHeight={200} placeholder={t('compose.writeMessagePlaceholder')} />
		</div>

		{#if loaded}{#key activeDraft}<DraftAutosave bind:this={autosave} id={activeDraft} {revision} payload={draftPayload} hasContent={hasDraftText} disabled={sending || imagesLoading} />{/key}{/if}
		<ComposerActions bind:attachments sending={sending} disabled={imagesLoading} error={error}>
			{#snippet extra()}
				<button
					type="button"
					class="z-text-btn"
					onclick={saveDraft}
					disabled={imagesLoading || savingDraft || !hasDraftText}
				>
					{savingDraft ? t('common.saving') : t('compose.saveDraft')}
				</button>
			{/snippet}
		</ComposerActions>
	</form>
</div>
