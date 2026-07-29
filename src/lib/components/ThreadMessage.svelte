<script lang="ts">
	import Icon from './Icon.svelte';
	import AttachmentList from './AttachmentList.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import EmailBody from './EmailBody.svelte';
	import { formatFullDate, formatRelativeDate } from '$lib/utils/date';
	import { splitQuotedText } from '$lib/utils/quotes';
	import type { ThreadMessage } from '$lib/types';

	let {
		message,
		expanded = false,
		onToggle
	}: {
		message: ThreadMessage;
		expanded?: boolean;
		onToggle: () => void;
	} = $props();

	const outbound = $derived(message.direction === 'outbound');
	const sender = $derived(outbound ? 'me' : message.from_addr);
	const initial = $derived((message.from_addr[0] ?? '?').toUpperCase());

	/** Text-only messages get the same treatment as HTML ones. */
	const text = $derived(splitQuotedText(message.body_text ?? ''));

	/** One-line teaser for the collapsed state — the reply, not its quotes. */
	const snippet = $derived(text.body.replace(/\s+/g, ' ').trim().slice(0, 140));

	let quoteOpen = $state(false);
</script>

<article class="message" class:collapsed={!expanded}>
	{#if expanded}
		<header class="head">
			<div class="avatar" class:self={outbound}>{outbound ? 'me' : initial}</div>

			<button type="button" class="who" onclick={onToggle}>
				<p class="name">
					{sender}
					<span class="direction">to {message.to_addr}</span>
				</p>
				<p class="when">{formatFullDate(message.created_at)}</p>
			</button>

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
						aria-label={quoteOpen ? 'Hide quoted text' : 'Show quoted text'}
						onclick={() => (quoteOpen = !quoteOpen)}
					>
						···
					</button>
					{#if quoteOpen}
						<p class="whitespace-pre-wrap quoted">{text.quoted}</p>
					{/if}
				{/if}
			{:else}
				<p class="empty">Empty message</p>
			{/if}
		</div>

		<AttachmentList emailId={message.id} attachments={message.attachments} compact />

		{#if message.status === 'bounced' || message.status === 'failed'}
			<p class="failure">
				<Icon name="error-warning-line" size={13} />
				{message.status_detail ?? "This message didn't reach the recipient."}
			</p>
		{/if}
	{:else}
		<button type="button" class="summary" onclick={onToggle}>
			<span class="avatar small" class:self={outbound}>{outbound ? 'me' : initial}</span>
			<span class="name">{sender}</span>
			<span class="snippet">{snippet}</span>
			{#if message.attachments.length > 0}
				<Icon name="attachment-2" size={13} />
			{/if}
			<span class="when">{formatRelativeDate(message.created_at)}</span>
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
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.direction {
		margin-left: 0.375rem;
		font-weight: 400;
		color: var(--color-muted);
	}

	.when {
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
