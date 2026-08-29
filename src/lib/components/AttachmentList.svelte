<script lang="ts">
	import Icon from './Icon.svelte';
	import { formatFileSize } from '$lib/utils/html';
	import {
		attachmentHref,
		attachmentIcon,
		isImageType,
		isPreviewableInline
	} from '$lib/utils/attachments';
	import type { EmailAttachmentMeta } from '$lib/types';
	import { plural, t } from '$lib/i18n';
	import { page } from '$app/stores';

	let {
		emailId,
		attachments,
		compact = false
	}: {
		emailId: string;
		attachments: EmailAttachmentMeta[];
		/** Drops the divider/spacing so it can sit inside a reply bubble. */
		compact?: boolean;
	} = $props();
</script>

{#if attachments.length > 0}
	<section class="attachments" class:compact>
		<h2 class="attachments-title">
			<Icon name="attachment-2" size={15} />
			{plural($page.data.locale, 'mailbox.attachment', 'mailbox.attachmentsCount', attachments.length)}
		</h2>

		<div class="attachments-grid">
			{#each attachments as file (file.id)}
				{#if isImageType(file.content_type)}
					<figure class="attachment-image">
						<a
							href={attachmentHref(emailId, file.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="image-link"
						>
							<img
								src={attachmentHref(emailId, file.id)}
								alt={file.filename}
								loading="lazy"
								decoding="async"
							/>
						</a>
						<figcaption class="attachment-meta">
							<span class="filename">{file.filename}</span>
							<span class="size">{formatFileSize(file.size_bytes)}</span>
							<a
								href={attachmentHref(emailId, file.id, true)}
								class="action"
								download={file.filename}
							>
								{t('mailbox.download')}
							</a>
						</figcaption>
					</figure>
				{:else}
					<div class="attachment-file">
						<div class="file-icon">
							<Icon name={attachmentIcon(file.content_type)} size={20} />
						</div>
						<div class="file-info">
							<p class="filename">{file.filename}</p>
							<p class="size">{formatFileSize(file.size_bytes)}</p>
						</div>
						<div class="file-actions">
							{#if isPreviewableInline(file.content_type)}
								<a
									href={attachmentHref(emailId, file.id)}
									target="_blank"
									rel="noopener noreferrer"
									class="action"
								>
									<Icon name="external-link-line" size={14} />
									{t('common.open')}
								</a>
							{/if}
							<a
								href={attachmentHref(emailId, file.id, true)}
								class="action"
								download={file.filename}
							>
								<Icon name="download-2-line" size={14} />
								{t('mailbox.download')}
							</a>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</section>
{/if}

<style>
	.attachments {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.attachments.compact {
		margin-top: 0.875rem;
		padding-top: 0;
		box-shadow: none;
	}

	.attachments-title {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.875rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.attachments-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.attachment-image {
		overflow: hidden;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		box-shadow: var(--shadow-xs);
	}

	.image-link {
		display: block;
		background: var(--color-surface-muted);
	}

	.image-link img {
		display: block;
		width: 100%;
		max-height: 20rem;
		object-fit: contain;
	}

	.attachment-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.filename {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.size {
		flex-shrink: 0;
		color: var(--color-muted);
	}

	.action {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text);
		transition: opacity 0.15s;
	}

	.action:hover {
		opacity: 0.7;
	}

	.attachment-file {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		box-shadow: var(--shadow-xs);
	}

	.file-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.625rem;
		color: var(--color-text-secondary);
		background: var(--color-surface);
	}

	.file-info {
		flex: 1;
		min-width: 0;
	}

	.file-info .filename {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.file-info .size {
		margin-top: 0.125rem;
		font-size: 0.75rem;
	}

	.file-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}
</style>
