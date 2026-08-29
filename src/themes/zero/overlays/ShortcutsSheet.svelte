<script lang="ts">
	const groups: { title: string; rows: { keys: string; label: string }[] }[] = [
		{
			title: 'General',
			rows: [
				{ keys: '⌘K', label: 'Search' },
				{ keys: 'C', label: 'Compose' },
				{ keys: '?', label: 'Shortcuts' },
				{ keys: 'Esc', label: 'Close' }
			]
		},
		{
			title: 'Mail',
			rows: [
				{ keys: 'E', label: 'Archive' },
				{ keys: 'D', label: 'Move to bin' },
				{ keys: 'S', label: 'Star' },
				{ keys: 'U', label: 'Mark unread' },
				{ keys: 'R', label: 'Reply' },
				{ keys: 'A', label: 'Reply all' },
				{ keys: 'F', label: 'Forward' },
				{ keys: '⌘↵', label: 'Send' }
			]
		},
		{
			title: 'Go to',
			rows: [
				{ keys: 'G I', label: 'Inbox' },
				{ keys: 'G D', label: 'Drafts' },
				{ keys: 'G T', label: 'Sent' },
				{ keys: 'G A', label: 'Archive' },
				{ keys: 'G B', label: 'Bin' },
				{ keys: 'G S', label: 'Settings' }
			]
		}
	];

	let { onClose }: { onClose: () => void } = $props();
</script>

<div
	class="z-palette-scrim"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div class="z-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">
		<header class="z-sheet-head">
			<h2>Keyboard shortcuts</h2>
			<button type="button" class="z-icon-chip" onclick={onClose}>Close</button>
		</header>
		{#each groups as group (group.title)}
			<h3 class="z-sheet-title">{group.title}</h3>
			<ul class="z-sheet-list">
				{#each group.rows as row (row.label)}
					<li>
						<span>{row.label}</span>
						<kbd>{row.keys}</kbd>
					</li>
				{/each}
			</ul>
		{/each}
	</div>
</div>
