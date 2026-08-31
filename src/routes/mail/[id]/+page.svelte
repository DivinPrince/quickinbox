<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import AttachmentPicker from '$lib/components/AttachmentPicker.svelte';
	import ThreadMessage from '$lib/components/ThreadMessage.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { hasInAppHistory, requestSkipViewTransition } from '$lib/app-chrome';
	import { APP_NAME } from '$lib/constants';
	import { plural, t } from '$lib/i18n';
	import { page } from '$app/stores';
	import type { OutboundAttachmentInput } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let replyHtml = $state('');
	let replyAttachments = $state<OutboundAttachmentInput[]>([]);
	let replyOpen = $state(false);
	let sending = $state(false);
	let error = $state('');

	type ForwardTarget = { kind: 'thread' } | { kind: 'message'; id: string };
	let forwardTarget = $state<ForwardTarget | null>(null);
	let forwardTo = $state('');
	let forwardHtml = $state('');
	let includeAttachments = $state(true);

	const messages = $derived(data.messages);
	const latest = $derived(messages[messages.length - 1]);
	const starred = $derived(messages.some((message) => message.is_starred));
	const forwardOpen = $derived(forwardTarget !== null);
	const forwardedMessages = $derived.by(() => {
		const target = forwardTarget;
		if (target?.kind === 'message') {
			return messages.filter((message) => message.id === target.id);
		}
		return target?.kind === 'thread' ? messages : [];
	});

	/** A forward carries the files of exactly the message(s) it copies. */
	const forwardFiles = $derived(
		forwardedMessages.reduce((count, message) => count + message.attachments.length, 0)
	);
	const forwardFrom = $derived.by(() => {
		const selected = forwardedMessages[forwardedMessages.length - 1];
		return selected
			? selected.direction === 'inbound'
				? selected.to_addr
				: selected.from_addr
			: null;
	});

	const backHref = $derived(
		data.trashed
			? '/trash'
			: data.archived
				? '/inbox?view=archive'
				: latest?.direction === 'outbound'
					? '/sent'
					: '/inbox'
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
	async function patch(body: Record<string, boolean>): Promise<Response | undefined> {
		if (!latest) return;
		return fetch(`/api/mail/${latest.id}`, {
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

	async function toggleArchive() {
		error = '';
		try {
			const response = await patch({ archived: !data.archived });
			if (!response?.ok) {
				error = t('mailbox.couldNotUpdateConversation');
				return;
			}
			goto(data.archived ? '/inbox?view=archive' : '/inbox');
		} catch {
			error = t('mailbox.conversationNetwork');
		}
	}

	async function trash() {
		await patch({ trashed: true });
		goto(backHref);
	}

	async function restore() {
		await patch({ trashed: false });
		goto('/inbox');
	}

	function goBack() {
		requestSkipViewTransition();
		if (hasInAppHistory()) {
			history.back();
			return;
		}
		void goto(backHref);
	}

	async function destroy() {
		if (!latest) return;
		await fetch(`/api/mail/${latest.id}`, { method: 'DELETE' });
		goto('/trash');
	}

	/** Reply and forward share the space below the thread, so only one is open. */
	function openReply() {
		forwardTarget = null;
		replyOpen = !replyOpen;
		error = '';
	}

	function openForward(target: ForwardTarget) {
		replyOpen = false;
		const sameTarget =
			forwardTarget?.kind === target.kind &&
			(target.kind === 'thread' ||
				(forwardTarget.kind === 'message' && forwardTarget.id === target.id));
		forwardTarget = sameTarget ? null : target;
		includeAttachments = true;
		error = '';
	}

	/** Forward the explicitly selected message, or the server-resolved whole thread. */
	async function sendForward(event: SubmitEvent) {
		event.preventDefault();
		if (!forwardTarget || !forwardTo.trim()) return;

		sending = true;
		error = '';

		try {
			const endpoint =
				forwardTarget.kind === 'thread'
					? `/api/mail/thread/${encodeURIComponent(data.threadId)}/forward`
					: `/api/mail/${encodeURIComponent(forwardTarget.id)}/forward`;
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to: forwardTo,
					html: isHtmlEmpty(forwardHtml) ? undefined : forwardHtml,
					text: isHtmlEmpty(forwardHtml) ? undefined : htmlToPlainText(forwardHtml),
					includeAttachments
				})
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('thread.failedToForward');
				return;
			}

			forwardTo = '';
			forwardHtml = '';
			forwardTarget = null;
			// The forward is our own message now, so the mailbox has changed.
			await invalidateAll();
		} catch {
			error = t('common.networkError');
		} finally {
			sending = false;
		}
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
				error = body.error ?? t('compose.failedToSend');
				return;
			}

			replyHtml = '';
			replyAttachments = [];
			replyOpen = false;
			// The sent reply is now part of this conversation.
			await invalidateAll();
		} catch {
			error = t('common.networkError');
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{data.subject} — {APP_NAME}</title>
</svelte:head>

<div class="mail-page">
	<header class="mail-toolbar">
		<a
			href={backHref}
			class="btn-ghost back-btn"
			aria-label={t('common.back')}
			onclick={(event) => {
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
				event.preventDefault();
				goBack();
			}}
		>
			<Icon name="arrow-left-line" size={18} />
		</a>

		<div class="toolbar-actions">
			<button
				type="button"
				class="icon-btn"
				class:starred
				aria-label={starred ? t('mailbox.removeStar') : t('mailbox.addStar')}
				onclick={toggleStar}
			>
				<Icon name={starred ? 'star-fill' : 'star-line'} size={16} />
			</button>

			{#if data.trashed}
				<button type="button" class="icon-btn" aria-label={t('mailbox.restore')} onclick={restore}>
					<Icon name="arrow-go-back-line" size={16} />
				</button>
				<button
					type="button"
					class="icon-btn danger"
					aria-label={t('mailbox.deletePermanently')}
					onclick={destroy}
				>
					<Icon name="delete-bin-2-line" size={16} />
				</button>
			{:else}
				<button type="button" class="icon-btn" aria-label={t('mailbox.markUnread')} onclick={markUnread}>
					<Icon name="mail-line" size={16} />
				</button>
				<button
					type="button"
					class="icon-btn"
					aria-label={data.archived ? t('mailbox.moveToInbox') : t('nav.archive')}
					onclick={toggleArchive}
				>
					<Icon name={data.archived ? 'inbox-line' : 'archive-line'} size={16} />
				</button>
				<button type="button" class="icon-btn" aria-label={t('mailbox.moveToTrash')} onclick={trash}>
					<Icon name="delete-bin-line" size={16} />
				</button>
			{/if}

			<button
				type="button"
				class="btn-ghost forward-all-launch"
				class:active={forwardOpen}
				aria-label={t('thread.forwardAll')}
				onclick={() => openForward({ kind: 'thread' })}
			>
				<Icon name="share-forward-line" size={16} />
				<span>{t('thread.forwardAll')}</span>
			</button>

			<button type="button" class="btn-primary reply-launch" onclick={openReply}>
				<Icon name="reply-line" size={16} />
				{replyOpen ? t('common.close') : t('thread.reply')}
			</button>
		</div>
	</header>

	{#if error && !forwardOpen && !replyOpen}
		<p class="reply-status" role="alert">{error}</p>
	{/if}

	<article class="surface-lg mail-card">
		<div class="subject-row">
			<h1>{data.subject}</h1>
			{#if messages.length > 1}
				<span class="thread-count">{plural($page.data.locale, 'thread.messagesCount', 'thread.messagesCount', messages.length)}</span>
			{/if}
		</div>

		{#if collapsedCount > 0}
			<button type="button" class="expand-all" onclick={expandAll}>
				{t('thread.expandAll', { count: messages.length })}
			</button>
		{/if}

		<div class="thread">
			{#each messages as message (message.id)}
				<ThreadMessage
					{message}
					receivedLabel={message.received_label}
					expanded={opened.has(message.id)}
					onToggle={() => toggleMessage(message.id)}
					onForward={() => openForward({ kind: 'message', id: message.id })}
				/>
			{/each}
		</div>
	</article>

	{#if forwardOpen}
		<form class="reply-section" onsubmit={sendForward}>
			<p class="forward-context">
				{forwardTarget?.kind === 'thread'
					? t('thread.forwardingAll', { count: forwardedMessages.length })
					: t('thread.forwardingOne')}
			</p>
			<div class="forward-row">
				<label class="field-label" for="forward-to">{t('compose.to')}</label>
				<input
					id="forward-to"
					type="text"
					bind:value={forwardTo}
					placeholder={t('compose.recipientPlaceholder')}
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					required
					class="field-input"
				/>
			</div>
			{#if forwardFrom}
				<p class="reply-from">
					{t('compose.from')}
					<strong>{forwardFrom}</strong>
				</p>
			{/if}

			<RichTextEditor
				bind:html={forwardHtml}
				embedded
				minHeight={140}
				placeholder={t('thread.notePlaceholder')}
			/>

			{#if forwardFiles > 0}
				<label class="forward-files">
					<input type="checkbox" bind:checked={includeAttachments} />
					{plural($page.data.locale, 'compose.includeAttachments', 'compose.includeAttachmentsPlural', forwardFiles)}
				</label>
			{/if}

			<div class="reply-footer forward-footer">
				<div class="reply-actions">
					<button type="button" class="btn-ghost" onclick={() => (forwardTarget = null)}>
						{t('common.cancel')}
					</button>
					<button type="submit" class="btn-primary" disabled={sending}>
						<Icon name="share-forward-line" size={16} />
						{sending ? t('common.sending') : t('thread.forward')}
					</button>
				</div>
			</div>

			{#if error}
				<p class="reply-status">{error}</p>
			{/if}
		</form>
	{:else if replyOpen}
		<form class="reply-section" onsubmit={sendReply}>
			<p class="reply-to">
				{t('thread.replyingTo')}
				<strong>
					{latest?.direction === 'inbound' ? latest.from_addr : latest?.to_addr}
				</strong>
			</p>
			{#if data.replyFrom}
				<p class="reply-from">
					{t('compose.from')}
					<strong>
						{#if data.replyFromName}{data.replyFromName} · {/if}{data.replyFrom}
					</strong>
				</p>
			{/if}

			<RichTextEditor bind:html={replyHtml} embedded minHeight={160} placeholder={t('thread.replyPlaceholder')} />

			<div class="reply-footer">
				<AttachmentPicker bind:attachments={replyAttachments} />
				<div class="reply-actions">
					<button type="button" class="btn-ghost" onclick={() => (replyOpen = false)}>
						{t('common.cancel')}
					</button>
					<button type="submit" class="btn-primary" disabled={sending}>
						<Icon name="send-plane-2-fill" size={16} />
						{sending ? t('common.sending') : t('common.send')}
					</button>
				</div>
			</div>

			{#if error}
				<p class="reply-status">{error}</p>
			{/if}
		</form>
	{:else}
		<button type="button" class="reply-prompt" onclick={openReply}>
			<Icon name="reply-line" size={15} />
			{t('thread.reply')}
		</button>
	{/if}
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

	.toolbar-actions :global(.icon-btn.active) {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
	}

	.forward-all-launch {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
	}

	.forward-all-launch.active {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
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
		margin-top: 1rem;
		padding: 1.75rem;
		background: var(--color-surface);
		border-radius: 1.25rem;
		box-shadow: var(--shadow-sm);
	}

	.reply-to,
	.reply-from {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.forward-context {
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.reply-from {
		margin: 0.25rem 0 0.625rem;
	}

	.reply-to strong,
	.reply-from strong {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.forward-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.625rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.forward-row .field-label {
		width: 2.5rem;
	}

	.forward-footer {
		justify-content: flex-end;
	}

	.forward-files {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
		cursor: pointer;
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

	.back-btn {
		flex-shrink: 0;
	}

	/* Dormant reply box at the foot of the thread; opens the composer. */
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 1rem;
		padding: 0.75rem 1.75rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s;
	}

	.reply-prompt:hover {
		background: var(--color-surface-muted);
	}

	@media (max-width: 900px) {
		.mail-page {
			display: flex;
			flex-direction: column;
			flex: 1;
			width: 100%;
			min-height: 0;
			height: 100%;
			background: var(--color-surface);
		}

		.mail-toolbar {
			position: sticky;
			top: 0;
			z-index: 20;
			min-height: calc(3.25rem + env(safe-area-inset-top));
			margin: 0;
			padding: env(safe-area-inset-top) 0.5rem 0.25rem;
			background: var(--color-surface);
			box-shadow: inset 0 -1px 0 var(--color-line);
		}

		.mail-toolbar .btn-primary {
			padding-left: 0.75rem;
			padding-right: 0.75rem;
		}

		.reply-launch {
			display: none;
		}

		.forward-all-launch span {
			display: none;
		}

		.mail-card {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			margin: 0;
			padding: 1.25rem 1rem 1.5rem;
			border-radius: 0;
			box-shadow: none;
			background: var(--color-surface);
		}

		.mail-card h1 {
			font-size: 1.125rem;
		}

		.reply-prompt {
			flex-shrink: 0;
			z-index: 10;
			margin: 0;
			width: auto;
			border-radius: 0;
			padding: 0.875rem 1rem calc(0.875rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.reply-section {
			flex-shrink: 0;
			z-index: 10;
			margin: 0;
			padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
			background: var(--color-surface);
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.reply-footer {
			flex-direction: column;
			align-items: stretch;
		}

		.reply-actions {
			margin-left: 0;
			width: 100%;
		}

		.reply-actions .btn-primary {
			flex: 1;
		}
	}
</style>
