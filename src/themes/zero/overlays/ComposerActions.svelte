<script lang="ts">
	import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '$lib/constants';
	import AttachmentIcon from '$lib/components/Icon.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import type { OutboundAttachmentInput } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import { t } from '$lib/i18n';

	let {
		sending = false,
		attachments = $bindable([]),
		includeOriginalAttachments = $bindable(true),
		error = '',
		allowNewAttachments = true,
		originalAttachmentCount = 0,
		extra
	}: {
		sending?: boolean;
		attachments?: OutboundAttachmentInput[];
		includeOriginalAttachments?: boolean;
		error?: string;
		allowNewAttachments?: boolean;
		originalAttachmentCount?: number;
		extra?: import('svelte').Snippet;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let attachError = $state('');
	let isMac = $state(true);

	$effect(() => {
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	});

	async function addFiles(files: FileList | null) {
		if (!files?.length) return;
		attachError = '';

		for (const file of files) {
			if (attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) {
				attachError = t('compose.maxFiles', { count: MAX_ATTACHMENTS_PER_EMAIL });
				break;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				const limitMb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
				attachError = t('compose.fileTooLarge', { name: file.name, limit: limitMb });
				continue;
			}
			const content = await fileToBase64(file);
			attachments = [
				...attachments,
				{
					filename: file.name,
					type: file.type || 'application/octet-stream',
					content
				}
			];
		}

		if (input) input.value = '';
	}

	function remove(index: number) {
		attachments = attachments.filter((_, i) => i !== index);
	}

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				resolve(result.split(',')[1] ?? '');
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}
</script>

<div class="z-composer-foot">
	<button type="submit" class="z-send" disabled={sending}>
		<span>{sending ? t('common.sending') : t('common.send')}</span>
		<span class="z-send-kbd">
			<span>{isMac ? '⌘' : 'Ctrl'}</span>
			<Icon name="CurvedArrow" size={14} />
		</span>
	</button>
	{#if allowNewAttachments}
		<button type="button" class="z-add" onclick={() => input?.click()}>
			<AttachmentIcon name="attachment-2" size={12} />
			<span>{t('attach.attach')}</span>
		</button>
		<input
			bind:this={input}
			type="file"
			multiple
			class="hidden"
			onchange={(event) => addFiles(event.currentTarget.files)}
		/>
	{/if}
	{#if originalAttachmentCount > 0}
		<label class="z-forward-files">
			<input type="checkbox" bind:checked={includeOriginalAttachments} />
			{t(originalAttachmentCount === 1 ? 'compose.includeAttachments' : 'compose.includeAttachmentsPlural', {
				count: originalAttachmentCount
			})}
		</label>
	{/if}
	{#if extra}
		{@render extra()}
	{/if}
	{#if attachments.length > 0}
		<div class="z-attach-chips">
			{#each attachments as file, index (file.filename + index)}
				<span class="z-attach-chip">
					<Icon name="Paper" size={12} />
					<span class="z-attach-name">{file.filename}</span>
					<Tooltip text={t('common.remove')}>
						<button type="button" class="z-attach-remove" aria-label={t('common.remove')} onclick={() => remove(index)}>
							<Icon name="X" size={12} />
						</button>
					</Tooltip>
				</span>
			{/each}
		</div>
	{/if}
	{#if attachError || error}
		<p class="z-composer-error">{attachError || error}</p>
	{/if}
</div>
