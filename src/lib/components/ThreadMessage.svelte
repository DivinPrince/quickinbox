<script lang="ts">
	import Icon from './Icon.svelte';
	import AttachmentList from './AttachmentList.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import EmailBody from './EmailBody.svelte';
	import { formatFullDate, formatRelativeDate } from '$lib/utils/date';
	import { splitQuotedText } from '$lib/utils/quotes';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import type { ThreadMessage } from '$lib/types';

	let {
		message,
		receivedLabel = null,
		expanded = false,
		onToggle,
		onForward
	}: {
		message: ThreadMessage;
		/** Name of the mailbox identity that received this message, when known. */
		receivedLabel?: string | null;
		expanded?: boolean;
		onToggle: () => void;
		onForward: () => void;
	} = $props();

	const outbound = $derived(message.direction === 'outbound');
	const sender = $derived(outbound ? t('common.me') : message.from_name || message.from_addr);
	const senderEmail = $derived(emailOf(message.from_addr));
	const initial = $derived(((message.from_name || message.from_addr)[0] ?? '?').toUpperCase());

	/** Text-only messages get the same treatment as HTML ones. */
	const text = $derived(splitQuotedText(message.body_text ?? ''));

	/** One-line teaser for the collapsed state — the reply, not its quotes. */
	const snippet = $derived(text.body.replace(/\s+/g, ' ').trim().slice(0, 140));

	let quoteOpen = $state(false);
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => () => clearTimeout(copiedTimer));

	/** `Name <a@b.com>` and bare addresses both copy as `a@b.com`. */
	function emailOf(value: string): string {
		const bracket = value.match(/<([^>]+)>/);
		if (bracket?.[1]) return bracket[1].trim();
		const email = value.match(/[^\s<>]+@[^\s<>]+/);
		return (email?.[0] ?? value).trim();
	}

	function markCopied() {
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1600);
	}

	function writeClipboard(value: string): boolean {
		const input = document.createElement('textarea');
		input.value = value;
		input.setAttribute('readonly', '');
		input.style.cssText = 'position:fixed;left:-9999px;top:0';
		document.body.appendChild(input);
		input.select();
		const ok = document.execCommand('copy');
		input.remove();
		return ok;
	}

	async function copySender(event?: Event) {
		event?.stopPropagation();
		try {
			await navigator.clipboard.writeText(senderEmail);
			markCopied();
			return;
		} catch {
			if (writeClipboard(senderEmail)) markCopied();
		}
	}

	function onSenderKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			void copySender();
		}
	}
</script>

<article class="message" class:collapsed={!expanded}>
	{#if expanded}
		<header class="head">
			<div class="avatar" class:self={outbound}>{outbound ? t('common.me') : initial}</div>

			<div class="who">
				<p class="name">
					<span
						class="sender"
						role="button"
						tabindex="0"
						title={copied ? t('common.copied') : t('thread.copyEmail', { email: senderEmail })}
						onclick={copySender}
						onkeydown={onSenderKeydown}
					>
						{sender}
					</span>
					<button
						type="button"
						class="copy-sender"
						class:copied
						aria-label={copied ? t('common.copied') : t('thread.copyEmail', { email: senderEmail })}
						onclick={copySender}
					>
						<Icon name={copied ? 'check-line' : 'file-copy-line'} size={13} />
					</button>
					<button type="button" class="direction" onclick={onToggle}>{t('thread.toLabel', { address: message.to_addr })}</button>
				</p>
				<button type="button" class="when" onclick={onToggle}>
					{formatFullDate(message.created_at, $page.data.locale)}
				</button>
				{#if !outbound}
					<p class="when">
						{receivedLabel
							? t('thread.receivedAtNamed', { address: message.to_addr, label: receivedLabel })
							: t('thread.receivedAt', { address: message.to_addr })}
					</p>
				{/if}
			</div>

			{#if outbound}
				<DeliveryStatus status={message.status} detail={message.status_detail} />
			{/if}
		</header>

		<div class="body mail-body">
			{#if message.body_html}
				<EmailBody html={message.body_html} />
			{:else if text.body}
				<p class="whitespace-pre-wrap">{text.body}</p>
				{#if text.quoted}
					<button
						type="button"
						class="quote-toggle"
						aria-expanded={quoteOpen}
						aria-label={quoteOpen ? t('thread.hideQuoted') : t('thread.showQuoted')}
						onclick={() => (quoteOpen = !quoteOpen)}
					>
						···
					</button>
					{#if quoteOpen}
						<p class="whitespace-pre-wrap quoted">{text.quoted}</p>
					{/if}
				{/if}
			{:else}
				<p class="empty">{t('thread.emptyMessage')}</p>
			{/if}
		</div>

		<AttachmentList emailId={message.id} attachments={message.attachments} compact />

		<div class="message-actions">
			<button type="button" class="btn-ghost" onclick={onForward}>
				<Icon name="share-forward-line" size={14} />
				{t('thread.forward')}
			</button>
		</div>

		{#if message.status === 'bounced' || message.status === 'failed'}
			<p class="failure">
				<Icon name="error-warning-line" size={13} />
				{message.status_detail ?? t('thread.didNotReach')}
			</p>
		{/if}
	{:else}
		<button type="button" class="summary" onclick={onToggle}>
			<span class="avatar small" class:self={outbound}>{outbound ? t('common.me') : initial}</span>
			<span class="name">{sender}</span>
			<span class="snippet">{snippet}</span>
			{#if message.attachments.length > 0}
				<Icon name="attachment-2" size={13} />
			{/if}
			<span class="when">{formatRelativeDate(message.created_at, $page.data.locale)}</span>
		</button>
	{/if}
</article>

<style>
	.message {
		padding: 1.25rem 0;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.message:last-child {
		box-shadow: none;
		padding-bottom: 0;
	}

	.collapsed {
		padding: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.avatar.self {
		color: var(--color-text-secondary);
		background: var(--color-surface-hover);
	}

	.avatar.small {
		width: 1.75rem;
		height: 1.75rem;
		font-size: 0.625rem;
	}

	.who {
		flex: 1;
		min-width: 0;
		text-align: left;
	}

	.name {
		display: flex;
		align-items: center;
		min-width: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.sender {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
		cursor: pointer;
	}

	.sender:hover,
	.sender:focus-visible {
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.copy-sender {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.25rem;
		height: 1.25rem;
		margin-left: 0.25rem;
		border-radius: 0.25rem;
		color: var(--color-muted);
		opacity: 0;
	}

	.copy-sender:hover,
	.copy-sender:focus-visible,
	.copy-sender.copied,
	.name:hover .copy-sender {
		opacity: 1;
	}

	.copy-sender:hover,
	.copy-sender:focus-visible {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.copy-sender.copied {
		color: var(--color-accent-text);
	}

	@media (hover: none) {
		.copy-sender {
			opacity: 1;
		}
	}

	.direction {
		margin-left: 0.375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 400;
		color: var(--color-muted);
	}

	.when {
		display: block;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.body {
		margin-top: 1rem;
		font-size: 0.9375rem;
	}

	.empty {
		font-style: italic;
		color: var(--color-muted);
	}

	.failure {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-danger);
	}

	.message-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.75rem;
	}

	.message-actions .btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
	}

	/* --- collapsed row --- */

	.summary {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.75rem 0;
		color: var(--color-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
		text-align: left;
	}

	.summary:hover {
		color: var(--color-text-secondary);
	}

	.summary .name {
		flex-shrink: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.snippet {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.summary .when {
		margin-top: 0;
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.quoted {
		margin-top: 0.5rem;
		padding-left: 0.75rem;
		color: var(--color-text-secondary);
		box-shadow: inset 2px 0 0 var(--color-line);
	}

	/* HTML messages fold their own quotes inside the message frame; this is the
	   same control for text-only mail. */
	.quote-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin: 0.5rem 0;
		padding: 0 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		line-height: 1.2;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		cursor: pointer;
	}

	.quote-toggle:hover {
		background: var(--color-surface-hover);
	}
</style>
