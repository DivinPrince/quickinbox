<script lang="ts">
	import Icon from './Icon.svelte';
	import Tooltip from './Tooltip.svelte';
	import { t } from '$lib/i18n';
	import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '$lib/constants';
	import { createInlineImage, InlineImageError, INLINE_IMAGE_TYPES } from '$lib/mail/inline-images';
	import type { OutboundAttachmentInput } from '$lib/types';

	let {
		html = $bindable(''),
		attachments = $bindable([]),
		imagesLoading = $bindable(false),
		allowImages = false,
		placeholder = t('compose.writeMessagePlaceholder'),
		minHeight = 240,
		embedded = false,
		fill = false,
		toolbarEnd
	}: {
		html?: string;
		attachments?: OutboundAttachmentInput[];
		imagesLoading?: boolean;
		allowImages?: boolean;
		placeholder?: string;
		minHeight?: number;
		embedded?: boolean;
		/** On phones, grow to fill the composer and drop the card chrome. */
		fill?: boolean;
		toolbarEnd?: import('svelte').Snippet;
	} = $props();

	let editor: HTMLDivElement | null = null;
	let imageInput = $state<HTMLInputElement>();
	let imageError = $state('');
	let savedRange: Range | null = null;
	// Deleted images stay available to browser Undo, but are removed from the
	// bound attachment list so drafts and outgoing mail contain only used parts.
	const imageCache = new Map<string, OutboundAttachmentInput>();

	function rememberImages(files: OutboundAttachmentInput[]) {
		for (const file of files) {
			if (file.disposition === 'inline' && file.contentId) imageCache.set(file.contentId, file);
		}
	}

	function snapshot(node: HTMLDivElement) {
		const copy = node.cloneNode(true) as HTMLDivElement;
		const used = new Map<string, OutboundAttachmentInput>();
		for (const image of copy.querySelectorAll('img')) {
			const src = image.getAttribute('src') ?? '';
			const cid = image.dataset.inlineImage ?? (src.startsWith('cid:') ? src.slice(4) : '');
			if (!cid) continue;
			image.setAttribute('src', `cid:${cid}`);
			image.removeAttribute('data-inline-image');
			image.style.maxWidth = '100%';
			image.style.height = 'auto';
			const file = imageCache.get(cid);
			if (file) used.set(cid, file);
		}
		return { html: copy.innerHTML, images: [...used.values()] };
	}

	export function focus(options?: FocusOptions) {
		editor?.focus(options);
	}

	/** Copy `html` into the live editor without resetting the caret on each keystroke. */
	function hydrateEditor(node: HTMLDivElement, next: { html: string; attachments: OutboundAttachmentInput[] }) {
		const apply = (value: typeof next) => {
			rememberImages(value.attachments);
			if (snapshot(node).html !== value.html) {
				node.innerHTML = value.html;
				savedRange = null;
			}
			for (const image of node.querySelectorAll('img')) {
				const src = image.getAttribute('src') ?? '';
				if (!src.startsWith('cid:')) continue;
				const file = imageCache.get(src.slice(4));
				if (!file?.contentId || !INLINE_IMAGE_TYPES.includes(file.type)) continue;
				image.dataset.inlineImage = file.contentId;
				image.setAttribute('src', `data:${file.type};base64,${file.content}`);
			}
		};
		apply(next);
		editor = node;
		return {
			update(value: typeof next) {
				apply(value);
			},
			destroy() {
				if (editor === node) { editor = null; imageCache.clear(); }
			}
		};
	}

	function exec(command: string, value?: string) {
		restoreSelection();
		document.execCommand(command, false, value);
		handleInput();
	}

	function handleInput() {
		if (!editor) return;
		rememberImages(attachments);
		const next = snapshot(editor);
		html = next.html;
		const files = [...attachments.filter((file) => file.disposition !== 'inline'), ...next.images];
		if (files.length !== attachments.length || files.some((file, index) => file !== attachments[index])) {
			attachments = files;
		}
		rememberSelection();
	}

	function rememberSelection() {
		const selection = window.getSelection();
		if (selection?.rangeCount && editor?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
			savedRange = selection.getRangeAt(0).cloneRange();
		}
	}

	function restoreSelection() {
		if (!editor) return;
		editor.focus();
		const selection = window.getSelection();
		if (!selection) return;
		const range = savedRange && editor.contains(savedRange.commonAncestorContainer)
			? savedRange : document.createRange();
		if (range !== savedRange) { range.selectNodeContents(editor); range.collapse(false); }
		selection.removeAllRanges();
		selection.addRange(range);
	}

	function chooseImages() {
		rememberSelection();
		imageInput?.click();
	}

	async function insertImages(files: File[]) {
		if (!allowImages || imagesLoading || !editor || !files.length) return;
		const target = editor;
		rememberSelection();
		imagesLoading = true;
		imageError = '';
		try {
			for (const file of files) {
				if (attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) {
					imageError = t('compose.maxFiles', { count: MAX_ATTACHMENTS_PER_EMAIL });
					break;
				}
				try {
					const image = await createInlineImage(file);
					if (editor !== target) return;
					imageCache.set(image.contentId!, image);
					const node = document.createElement('img');
					node.src = `data:${image.type};base64,${image.content}`;
					node.alt = image.filename;
					node.dataset.inlineImage = image.contentId;
					node.style.maxWidth = '100%';
					node.style.height = 'auto';
					// insertHTML keeps insertion, deletion, and Undo in the editor's history.
					exec('insertHTML', `${node.outerHTML}<br>`);
				} catch (error) {
					imageError = error instanceof InlineImageError && error.reason === 'size'
						? t('compose.fileTooLarge', { name: file.name, limit: MAX_ATTACHMENT_BYTES / 1024 / 1024 })
						: error instanceof InlineImageError && error.reason === 'format'
							? t('editor.imageFormats') : t('editor.imageFailed');
				}
			}
		} finally {
			imagesLoading = false;
			if (imageInput) imageInput.value = '';
		}
	}

	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		if (imagesLoading) return;
		const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
		if (allowImages && images.length) { void insertImages(images); return; }
		rememberSelection();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		exec('insertText', text);
	}

	function handleDrop(event: DragEvent) {
		if (!event.dataTransfer?.files.length) return;
		event.preventDefault();
		if (!allowImages || imagesLoading) return;
		const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
		if (range && editor?.contains(range.commonAncestorContainer)) savedRange = range;
		restoreSelection();
		void insertImages([...event.dataTransfer.files]);
	}

	type EditorTool = {
		icon: string;
		command: string;
		label: string;
		prompt?: boolean;
	};

	const tools = $derived<EditorTool[]>([
		{ icon: 'bold', command: 'bold', label: t('editor.bold') },
		{ icon: 'italic', command: 'italic', label: t('editor.italic') },
		{ icon: 'underline', command: 'underline', label: t('editor.underline') },
		{ icon: 'list-unordered', command: 'insertUnorderedList', label: t('editor.list') },
		{ icon: 'link', command: 'createLink', label: t('editor.link'), prompt: true }
	]);

	function handleTool(tool: EditorTool) {
		if (tool.prompt) {
			const url = window.prompt(t('editor.linkUrl'));
			if (url) exec('createLink', url);
			return;
		}
		exec(tool.command);
	}
</script>

<svelte:document onselectionchange={rememberSelection} />

<div class="editor-shell" class:editor-shell-embedded={embedded} class:editor-shell-fill={fill}>
	<!-- Keep the message field before formatting controls in the keyboard order. -->
	<div
		use:hydrateEditor={{ html, attachments }}
		contenteditable="true"
		aria-busy={imagesLoading}
		role="textbox"
		tabindex="0"
		aria-label={placeholder}
		aria-multiline="true"
		class="editor prose prose-sm max-w-none px-4 py-3 outline-none"
		style:--editor-min-height="{minHeight}px"
		data-placeholder={placeholder}
		oninput={handleInput}
		onpaste={handlePaste}
		ondragover={(event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); }}
		ondrop={handleDrop}
	></div>

	<div class="toolbar">
		{#each tools as tool (tool.command)}
			<Tooltip text={tool.label}>
				<button
					type="button"
					class="icon-btn"
					aria-label={tool.label}
					disabled={imagesLoading}
					onpointerdown={(event) => { rememberSelection(); event.preventDefault(); }}
					onclick={() => handleTool(tool)}
				>
					<Icon name={tool.icon} size={16} />
				</button>
			</Tooltip>
		{/each}
		{#if allowImages}
			<Tooltip text={t('editor.insertImage')}>
				<button type="button" class="icon-btn" aria-label={t('editor.insertImage')} disabled={imagesLoading}
					onpointerdown={(event) => { rememberSelection(); event.preventDefault(); }} onclick={chooseImages}>
					<Icon name="image-add-line" size={16} />
				</button>
			</Tooltip>
			<input bind:this={imageInput} type="file" accept={INLINE_IMAGE_TYPES.join(',')} multiple hidden
				onchange={(event) => insertImages([...(event.currentTarget.files ?? [])])} />
		{/if}
		{#if toolbarEnd}
			<div class="toolbar-end">
				{@render toolbarEnd()}
			</div>
		{/if}
	</div>

	{#if imagesLoading || imageError}
		<p class="image-status" role="status">{imagesLoading ? t('editor.addingImages') : imageError}</p>
	{/if}
</div>

<style>
	.editor-shell {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
	}

	.editor-shell-embedded {
		border-radius: 0;
		box-shadow: none;
		background: transparent;
	}

	.editor-shell-embedded .toolbar {
		padding-left: 0;
		padding-right: 0;
	}

	.editor-shell-embedded .editor {
		padding-left: 0;
		padding-right: 0;
	}

	.toolbar {
		order: -1;
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 0.5rem;
	}

	.toolbar-end {
		display: none;
	}

	.editor {
		min-height: var(--editor-min-height, 240px);
		color: var(--color-text);
	}

	@media (max-width: 900px) {
		.toolbar {
			flex-wrap: wrap;
		}

		.toolbar .icon-btn {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.editor {
			font-size: 16px;
		}

		.editor-shell-fill {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 0;
			border-radius: 0;
			box-shadow: none;
			background: transparent;
		}

		.editor-shell-fill .toolbar {
			order: 2;
			flex-shrink: 0;
			padding: 0.125rem 0.375rem calc(0.125rem + env(safe-area-inset-bottom));
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.editor-shell-fill .toolbar-end {
			display: flex;
			align-items: center;
			gap: 0.125rem;
			margin-left: auto;
		}

		.editor-shell-fill .editor {
			flex: 1;
			min-height: 8rem;
			overflow-y: auto;
			padding: 0.75rem 1rem 1rem;
		}
	}

	.editor:empty::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		pointer-events: none;
	}

	.editor :global(p) {
		margin: 0 0 0.75em;
	}

	.editor :global(p:last-child) {
		margin-bottom: 0;
	}

	/* Tailwind's reset drops list markers, so a bulleted list typed here would
	   otherwise look like plain paragraphs. */
	.editor :global(ul) {
		list-style: disc outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(ol) {
		list-style: decimal outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(li) {
		margin: 0.15em 0;
	}

	.editor :global(a) {
		color: var(--color-accent-text);
		text-decoration: underline;
	}

	.editor :global(img) {
		max-width: 100%;
		height: auto;
	}

	.image-status {
		padding: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}
</style>
