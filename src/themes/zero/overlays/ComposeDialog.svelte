<script lang="ts">
	import { untrack } from 'svelte';
	import DraftAutosave from '$lib/components/DraftAutosave.svelte';
	import { createMailSender } from '$lib/mail/send';
	const sendMail = createMailSender();
	import { goto, invalidateAll } from '$app/navigation';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import type { MailAddress, OutboundAttachmentInput } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
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
	let savingDraft = $state(false);

	$effect(() => {
		const id = draftId;
		if (!id || (id === activeDraft && loaded)) return;
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
		savingDraft = true;
		try { return await autosave?.flush() ?? false; } finally { savingDraft = false; }
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (isHtmlEmpty(html)) {
			error = t('compose.writeMessage');
			return;
		}
		if (!loaded || sending || !(await saveDraft())) return;
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
			if (body.id) await goto(`/sent?thread=${encodeURIComponent(body.id)}`);
		} catch {
			error = t('common.networkError');
		} finally {
			sending = false;
		}
	}

	async function close() {
		if (sending) return;
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

<div class="z-overlay" onkeydown={onKey} role="dialog" aria-modal="true" tabindex="-1">
	<div class="z-compose-stage">
		<button type="button" class="z-esc" aria-label={t('common.close')} onclick={close}>
			<Icon name="X" size={14} />
			<span>esc</span>
		</button>

		<form class="z-composer" onsubmit={send} inert={!loaded || sending}>
			<div class="z-composer-fields">
				<div class="z-composer-row">
					<span class="z-composer-label">{t('compose.toColon')}</span>
					<input class="z-composer-input" bind:value={to} required placeholder={t('compose.emailPlaceholder')} />
					<div class="z-composer-row-actions">
						<button type="button" class="z-composer-link" onclick={() => (showCc = !showCc)}>{t('compose.cc')}</button>
						<button type="button" class="z-composer-link" onclick={() => (showBcc = !showBcc)}>{t('compose.bcc')}</button>
						<Tooltip text={t('common.close')}>
							<button type="button" class="z-composer-link" aria-label={t('common.close')} onclick={close}>
								<Icon name="X" size={14} />
							</button>
						</Tooltip>
					</div>
				</div>
				{#if showCc}
					<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.ccColon')}</span>
						<input class="z-composer-input" bind:value={cc} placeholder={t('compose.ccPlaceholder')} />
					</div>
				{/if}
				{#if showBcc}
					<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.bccColon')}</span>
						<input class="z-composer-input" bind:value={bcc} placeholder={t('compose.bccPlaceholder')} />
					</div>
				{/if}
				<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.subjectColon')}</span>
						<input class="z-composer-input" bind:value={subject} required placeholder={t('compose.subject')} />
				</div>
				{#if addresses.length > 1}
					<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.fromColon')}</span>
						<select
							class="z-composer-input"
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
				<RichTextEditor bind:html embedded minHeight={200} placeholder={t('compose.writeMessagePlaceholder')} />
			</div>

			{#if loaded}{#key activeDraft}<DraftAutosave bind:this={autosave} id={activeDraft} {revision} payload={draftPayload} hasContent={hasDraftText} disabled={sending} />{/key}{/if}
			<ComposerActions bind:attachments sending={sending} error={error}>
				{#snippet extra()}
					<button
						type="button"
						class="z-text-btn"
						onclick={saveDraft}
						disabled={savingDraft || !hasDraftText}
					>
						{savingDraft ? t('common.saving') : t('compose.saveDraft')}
					</button>
				{/snippet}
			</ComposerActions>
		</form>
	</div>
</div>
