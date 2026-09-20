<script lang="ts">
	import { t } from '$lib/i18n';

	let { value, onChange }: {
		value: 'vertical' | 'horizontal';
		onChange: (value: 'vertical' | 'horizontal') => void;
	} = $props();
</script>

<div class="z-layout-picker" title={t('panes.splitLayout')}>
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
		<rect x="3" y="3" width="18" height="18" rx="3" />
		{#if value === 'horizontal'}
			<path d="M3 12h18" />
		{:else}
			<path d="M12 3v18" />
		{/if}
	</svg>
	<select
		aria-label={t('panes.splitLayout')}
		{value}
		onchange={(event) => onChange(event.currentTarget.value as 'vertical' | 'horizontal')}
	>
		<option value="vertical">{t('panes.verticalSplit')}</option>
		<option value="horizontal">{t('panes.horizontalSplit')}</option>
	</select>
</div>
