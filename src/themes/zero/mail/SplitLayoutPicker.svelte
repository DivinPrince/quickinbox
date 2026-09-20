<script module lang="ts">
	export type SplitLayout = 'none' | 'vertical' | 'horizontal';
</script>

<script lang="ts">
	import { t } from '$lib/i18n';

	let { value, onChange }: {
		value: SplitLayout;
		onChange: (value: SplitLayout) => void;
	} = $props();
</script>

<div class="z-layout-picker" title={t('panes.splitLayout')}>
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
		<rect x="3" y="3" width="18" height="18" rx="3" />
		{#if value === 'none'}
			<path d="M7 8h10M7 12h10M7 16h10" />
		{:else if value === 'horizontal'}
			<path d="M3 12h18" />
		{:else}
			<path d="M12 3v18" />
		{/if}
	</svg>
	<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
		<path d="m2 4 3 3 3-3Z" />
	</svg>
	<select
		aria-label={t('panes.splitLayout')}
		{value}
		onchange={(event) => onChange(event.currentTarget.value as SplitLayout)}
	>
		<option value="none">{t('panes.noSplit')}</option>
		<option value="vertical">{t('panes.verticalSplit')}</option>
		<option value="horizontal">{t('panes.horizontalSplit')}</option>
	</select>
</div>
