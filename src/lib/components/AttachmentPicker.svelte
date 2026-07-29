<script lang="ts">
	import Icon from './Icon.svelte';
	import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '$lib/constants';
	import type { OutboundAttachmentInput } from '$lib/types';

	let {
		attachments = $bindable([])
	}: {
		attachments?: OutboundAttachmentInput[];
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let error = $state('');

	async function addFiles(files: FileList | null) {
		if (!files?.length) return;
		error = '';

		for (const file of files) {
			if (attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) {
				error = `Max ${MAX_ATTACHMENTS_PER_EMAIL} files`;
				break;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				const limitMb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
				error = `"${file.name}" exceeds ${limitMb}MB`;
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

<div class="flex flex-wrap items-center gap-2">
	<button type="button" class="attach-btn" onclick={() => input?.click()}>
		<Icon name="attachment-2" size={16} />
		<span>Attach</span>
	</button>

	<input
		bind:this={input}
		type="file"
		multiple
		class="hidden"
		onchange={(event) => addFiles(event.currentTarget.files)}
	/>

	{#each attachments as file, index (file.filename + index)}
		<span class="attachment-chip">
			<Icon name="file-3-line" size={14} />
			<span class="max-w-[140px] truncate">{file.filename}</span>
			<button type="button" class="chip-remove" aria-label="Remove" onclick={() => remove(index)}>
				<Icon name="close-line" size={14} />
			</button>
		</span>
	{/each}
</div>

{#if error}
	<p class="mt-2 text-xs text-[var(--color-text-secondary)]">{error}</p>
{/if}

<style>
	.attach-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
		transition: background 0.15s, color 0.15s;
	}

	.attach-btn:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.attachment-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		box-shadow: var(--shadow-xs);
	}

	.chip-remove {
		display: flex;
		color: var(--color-muted);
		transition: color 0.15s;
	}

	.chip-remove:hover {
		color: var(--color-text);
	}
</style>
