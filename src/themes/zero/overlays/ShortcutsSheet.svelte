<script lang="ts">
	import { t } from '$lib/i18n';

	const groups = $derived([
		{
			title: t('shortcuts.groupGeneral'),
			rows: [
				{ keys: '⌘K', label: t('shortcuts.search') },
				{ keys: 'C', label: t('shortcuts.compose') },
				{ keys: '?', label: t('shortcuts.shortcuts') },
				{ keys: 'Esc', label: t('shortcuts.close') }
			]
		},
		{
			title: t('shortcuts.groupMail'),
			rows: [
				{ keys: 'E', label: t('shortcuts.archive') },
				{ keys: 'D', label: t('shortcuts.moveToBin') },
				{ keys: 'S', label: t('shortcuts.star') },
				{ keys: 'U', label: t('shortcuts.markUnread') },
				{ keys: 'R', label: t('shortcuts.reply') },
				{ keys: 'A', label: t('shortcuts.replyAll') },
				{ keys: 'F', label: t('shortcuts.forward') },
				{ keys: '⌘↵', label: t('shortcuts.send') }
			]
		},
		{
			title: t('shortcuts.groupGoTo'),
			rows: [
				{ keys: 'G I', label: t('shortcuts.inbox') },
				{ keys: 'G D', label: t('shortcuts.drafts') },
				{ keys: 'G T', label: t('shortcuts.sent') },
				{ keys: 'G A', label: t('nav.archive') },
				{ keys: 'G B', label: t('nav.bin') },
				{ keys: 'G S', label: t('nav.settings') }
			]
		}
	]);

	let { onClose }: { onClose: () => void } = $props();
</script>

<div
	class="z-palette-scrim"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div class="z-sheet" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')} tabindex="-1">
		<header class="z-sheet-head">
			<h2>{t('shortcuts.title')}</h2>
			<button type="button" class="z-icon-chip" onclick={onClose}>{t('common.close')}</button>
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
