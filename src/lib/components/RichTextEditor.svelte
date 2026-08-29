<script lang="ts">
	import Icon from './Icon.svelte';
	import Tooltip from './Tooltip.svelte';
	import { t } from '$lib/i18n';

	let {
		html = $bindable(''),
		placeholder = t('compose.writeMessagePlaceholder'),
		minHeight = 240,
		embedded = false,
		fill = false,
		toolbarEnd
	}: {
		html?: string;
		placeholder?: string;
		minHeight?: number;
		embedded?: boolean;
		/** On phones, grow to fill the composer and drop the card chrome. */
		fill?: boolean;
		toolbarEnd?: import('svelte').Snippet;
	} = $props();

	let editor: HTMLDivElement | null = null;

	/** Copy `html` into the live editor without resetting the caret on each keystroke. */
	function hydrateEditor(node: HTMLDivElement, next: string) {
		const apply = (value: string) => {
			if (node.innerHTML !== value) node.innerHTML = value;
		};
		apply(next);
		editor = node;
		return {
			update(value: string) {
				apply(value);
			},
			destroy() {
				if (editor === node) editor = null;
			}
		};
	}

	function exec(command: string, value?: string) {
		editor?.focus();
		document.execCommand(command, false, value);
		html = editor?.innerHTML ?? '';
	}

	function handleInput() {
		html = editor?.innerHTML ?? '';
	}

	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
		html = editor?.innerHTML ?? '';
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

<div class="editor-shell" class:editor-shell-embedded={embedded} class:editor-shell-fill={fill}>
	<div class="toolbar">
		{#each tools as tool (tool.command)}
			<Tooltip text={tool.label}>
				<button
					type="button"
					class="icon-btn"
					aria-label={tool.label}
					onclick={() => handleTool(tool)}
				>
					<Icon name={tool.icon} size={16} />
				</button>
			</Tooltip>
		{/each}
		{#if toolbarEnd}
			<div class="toolbar-end">
				{@render toolbarEnd()}
			</div>
		{/if}
	</div>

	<div
		use:hydrateEditor={html}
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		class="editor prose prose-sm max-w-none px-4 py-3 outline-none"
		style:--editor-min-height="{minHeight}px"
		data-placeholder={placeholder}
		oninput={handleInput}
		onpaste={handlePaste}
	></div>
</div>

<style>
	.editor-shell {
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
</style>
