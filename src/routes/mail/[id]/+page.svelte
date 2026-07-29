<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import ThreadMessage from '$lib/components/ThreadMessage.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import type { OutboundAttachmentInput } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let replyHtml = $state('');
	let replyAttachments = $state<OutboundAttachmentInput[]>([]);
	let replyOpen = $state(false);
	let sending = $state(false);
	let error = $state('');

	const messages = $derived(data.messages);
	const latest = $derived(messages[messages.length - 1]);
	const starred = $derived(messages.some((message) => message.is_starred));

	const backHref = $derived(
		data.trashed ? '/trash' : latest?.direction === 'outbound' ? '/sent' : '/inbox'
	);

	/**
	 * Which messages are open: the newest one, whichever message was linked to,
	 * and anything the reader clicks.
	 */
	let opened = $state(new Set<string>());

	$effect(() => {
		const initial = new Set<string>();
		if (data.focusId) initial.add(data.focusId);
		const last = data.messages[data.messages.length - 1];
		if (last) initial.add(last.id);
		opened = initial;
	});

	function toggleMessage(id: string) {
		const next = new Set(opened);
		if (next.has(id) && next.size > 1) next.delete(id);
		else next.add(id);
		opened = next;
	}

	function expandAll() {
		opened = new Set(messages.map((message) => message.id));
	}

	const collapsedCount = $derived(messages.filter((message) => !opened.has(message.id)).length);

	/** Flags apply to the conversation, not to the message that opened it. */
	async function patch(body: Record<string, boolean>) {
		if (!latest) return;
		await fetch(`/api/mail/${latest.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function toggleStar() {
		await patch({ isStarred: !starred });
		await invalidateAll();
	}

	async function markUnread() {
		await patch({ isRead: false });
		goto(backHref);
	}

	async function trash() {
		await patch({ trashed: true });
		goto(backHref);
	}

	async function restore() {
		await patch({ trashed: false });
		goto('/inbox');
	}

	async function destroy() {
		if (!latest) return;
		await fetch(`/api/mail/${latest.id}`, { method: 'DELETE' });
		goto('/trash');
	}

	/** Replies continue from the newest message, so the chain stays intact. */
	async function sendReply(event: SubmitEvent) {
		event.preventDefault();
		if (!latest || isHtmlEmpty(replyHtml)) return;

		sending = true;
		error = '';

		try {
			const res = await fetch(`/api/mail/${latest.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					html: replyHtml,
					text: htmlToPlainText(replyHtml),
					attachments: replyAttachments
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Failed to send';
				return;
			}

			replyHtml = '';
			replyAttachments = [];
			replyOpen = false;
			// The sent reply is now part of this conversation.
			await invalidateAll();
		} catch {
			error = 'Network error';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{data.subject} — Mail</title>
</svelte:head>

<div class="mail-page">
	<header class="mail-toolbar">
		<a href={backHref} class="btn-ghost" aria-label="Back">
			<Icon name="arrow-left-line" size={18} />
		</a>

		<div class="toolbar-actions">
			<button
				type="button"
				class="icon-btn"
				class:starred
				aria-label={starred ? 'Remove star' : 'Add star'}
				onclick={toggleStar}
			>
				<Icon name={starred ? 'star-fill' : 'star-line'} size={16} />
			</button>

			{#if data.trashed}
				<button type="button" class="icon-btn" aria-label="Restore" onclick={restore}>
					<Icon name="arrow-go-back-line" size={16} />
				</button>
				<button
					type="button"
					class="icon-btn danger"
					aria-label="Delete permanently"
					onclick={destroy}
				>
					<Icon name="delete-bin-2-line" size={16} />
				</button>
			{:else}
				<button type="button" class="icon-btn" aria-label="Mark as unread" onclick={markUnread}>
					<Icon name="mail-line" size={16} />
				</button>
				<button type="button" class="icon-btn" aria-label="Move to trash" onclick={trash}>
					<Icon name="delete-bin-line" size={16} />
				</button>
			{/if}

			<button type="button" class="btn-primary" onclick={() => (replyOpen = !replyOpen)}>
				<Icon name="reply-line" size={16} />
				{replyOpen ? 'Close' : 'Reply'}
			</button>
		</div>
	</header>

	<article class="surface-lg mail-card">
		<div class="subject-row">
			<h1>{data.subject}</h1>
			{#if messages.length > 1}
				<span class="thread-count">{messages.length} messages</span>
			{/if}
		</div>

		{#if collapsedCount > 0}
			<button type="button" class="expand-all" onclick={expandAll}>
				Expand all {messages.length} messages
			</button>
		{/if}

		<div class="thread">
			{#each messages as message (message.id)}
				<ThreadMessage
					{message}
					expanded={opened.has(message.id)}
					onToggle={() => toggleMessage(message.id)}
				/>
			{/each}
		</div>

		{#if replyOpen}
			<form class="reply-section" onsubmit={sendReply}>
				<p class="reply-to">
					Replying to
					<strong>
						{latest?.direction === 'inbound' ? latest.from_addr : latest?.to_addr}
					</strong>
				</p>

				<RichTextEditor bind:html={replyHtml} embedded minHeight={160} placeholder="Reply…" />

				<div class="reply-footer">
					<AttachmentPicker bind:attachments={replyAttachments} />
					<div class="reply-actions">
						<button type="button" class="btn-ghost" onclick={() => (replyOpen = false)}>
							Cancel
						</button>
						<button type="submit" class="btn-primary" disabled={sending}>
							<Icon name="send-plane-2-fill" size={16} />
							{sending ? 'Sending…' : 'Send'}
						</button>
					</div>
				</div>

				{#if error}
					<p class="reply-status">{error}</p>
				{/if}
			</form>
		{:else}
			<button type="button" class="reply-prompt" onclick={() => (replyOpen = true)}>
				<Icon name="reply-line" size={15} />
				Reply
			</button>
		{/if}
	</article>
</div>

<style>
	.mail-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.toolbar-actions :global(.icon-btn.starred) {
		color: var(--color-star);
	}

	.toolbar-actions :global(.icon-btn.danger:hover) {
		color: var(--color-danger);
	}

	.mail-card {
		padding: 1.75rem;
	}

	.mail-card h1 {
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.35;
	}

	.subject-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding-bottom: 1rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.thread-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.expand-all {
		margin-top: 0.875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		text-decoration: underline;
	}

	.expand-all:hover {
		color: var(--color-text);
	}

	.reply-section {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.reply-to {
		margin-bottom: 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.reply-to strong {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.reply-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.reply-actions {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	.reply-status {
		margin-top: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	/* Dormant reply box at the foot of the thread; opens the composer. */
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 1.5rem;
		padding: 0.75rem 1rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s;
	}

	.reply-prompt:hover {
		background: var(--color-surface-muted);
	}
</style>
