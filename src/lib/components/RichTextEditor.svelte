<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		html = $bindable(''),
		placeholder = 'Write your message…',
		minHeight = 240,
		embedded = false
	}: {
		html?: string;
		placeholder?: string;
		minHeight?: number;
		embedded?: boolean;
	} = $props();

	let editor = $state<HTMLDivElement | null>(null);

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

	const tools = [
		{ icon: 'bold', command: 'bold', label: 'Bold' },
		{ icon: 'italic', command: 'italic', label: 'Italic' },
		{ icon: 'underline', command: 'underline', label: 'Underline' },
		{ icon: 'list-unordered', command: 'insertUnorderedList', label: 'List' },
		{ icon: 'link', command: 'createLink', label: 'Link', prompt: true }
	] as const;

	function handleTool(tool: (typeof tools)[number]) {
		if ('prompt' in tool && tool.prompt) {
			const url = window.prompt('Link URL');
			if (url) exec('createLink', url);
			return;
		}
		exec(tool.command);
	}
</script>

<div class="editor-shell" class:editor-shell-embedded={embedded}>
	<div class="toolbar">
		{#each tools as tool (tool.command)}
			<button
				type="button"
				class="icon-btn"
				title={tool.label}
				aria-label={tool.label}
				onclick={() => handleTool(tool)}
			>
				<Icon name={tool.icon} size={16} />
			</button>
		{/each}
	</div>

	<div
		bind:this={editor}
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		class="editor prose prose-sm max-w-none px-4 py-3 outline-none"
		style="min-height: {minHeight}px"
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

	.editor {
		color: var(--color-text);
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
