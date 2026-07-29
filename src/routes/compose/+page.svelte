<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
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
	let html = $state(draft?.body_html ?? '');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let showCopies = $state(Boolean(draft?.cc_addr || draft?.bcc_addr));
	let error = $state('');
	let sending = $state(false);
	let savingDraft = $state(false);
	let savedAt = $state('');

	const isEmpty = $derived(!to.trim() && !subject.trim() && isHtmlEmpty(html));

	async function saveDraft() {
		if (savingDraft || isEmpty) return;
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
				error = body.error ?? 'Could not save draft';
				return;
			}
			draftId = body.id;
			savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			error = 'Network error';
		} finally {
			savingDraft = false;
		}
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
			error = 'Write a message';
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
				error = body.error ?? 'Failed to send';
				return;
			}
			window.location.href = '/sent';
		} catch {
			error = 'Network error';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{draftId ? 'Draft' : 'Compose'} — Mail</title>
</svelte:head>

<form class="compose-page" onsubmit={submit}>
	<header class="compose-header">
		<div class="compose-heading">
			<h1 class="page-title">{draftId ? 'Draft' : 'New message'}</h1>
			{#if savedAt}<span class="saved">Saved {savedAt}</span>{/if}
		</div>

		<div class="compose-actions">
			<button
				type="button"
				class="btn-ghost"
				onclick={() => (showCopies = !showCopies)}
				aria-expanded={showCopies}
			>
				Cc/Bcc
			</button>
			<button type="button" class="btn-ghost" disabled={savingDraft || isEmpty} onclick={saveDraft}>
				<Icon name="save-line" size={15} />
				{savingDraft ? 'Saving…' : 'Save draft'}
			</button>
			{#if draftId}
				<button type="button" class="btn-ghost" onclick={discardDraft} aria-label="Discard draft">
					<Icon name="delete-bin-line" size={15} />
				</button>
			{/if}
			<button type="submit" class="btn-primary" disabled={sending}>
				<Icon name="send-plane-2-fill" size={16} />
				{sending ? 'Sending…' : 'Send'}
			</button>
		</div>
	</header>

	<div class="surface compose-fields">
		<!-- With several domains connected, choosing the identity matters. -->
		<div class="field-row">
			<span class="field-label">From</span>
			{#if addresses.length > 1}
				<select
					value={fromAddressId}
					onchange={(event) => (chosenAddressId = event.currentTarget.value)}
					class="field-input"
					aria-label="Send from"
				>
					{#each addresses as address (address.id)}
						<option value={address.id}>{address.address}</option>
					{/each}
				</select>
			{:else}
				<span class="field-static">{addresses[0]?.address ?? '—'}</span>
			{/if}
		</div>

		<div class="field-row">
			<span class="field-label">To</span>
			<input
				id="to"
				type="text"
				bind:value={to}
				required
				placeholder="recipient@example.com"
				class="field-input"
			/>
		</div>

		{#if showCopies}
			<div class="field-row">
				<span class="field-label">Cc</span>
				<input type="text" bind:value={cc} placeholder="Comma separated" class="field-input" />
			</div>
			<div class="field-row">
				<span class="field-label">Bcc</span>
				<input type="text" bind:value={bcc} placeholder="Comma separated" class="field-input" />
			</div>
		{/if}

		<div class="field-row">
			<span class="field-label">Subject</span>
			<input
				id="subject"
				type="text"
				bind:value={subject}
				required
				placeholder="Subject"
				class="field-input"
			/>
		</div>
	</div>

	<div class="mt-4">
		<RichTextEditor bind:html minHeight={320} />
	</div>

	<div class="mt-4 px-1">
		<AttachmentPicker bind:attachments />
	</div>

	{#if error}
		<p class="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
	{/if}
</form>

<style>
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
</style>
