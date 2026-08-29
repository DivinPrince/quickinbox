<script lang="ts">
	import { t } from '$lib/i18n';

	let {
		localPart = $bindable(''),
		domainId = $bindable(''),
		domains,
		placeholder = 'you',
		label = t('setup.yourAddress')
	}: {
		localPart: string;
		domainId: string;
		domains: Array<{ id: string; name: string }>;
		placeholder?: string;
		label?: string;
	} = $props();

	const id = `address-${Math.random().toString(36).slice(2, 8)}`;
</script>

<label class="field-title" for={id}>{label}</label>
<div class="address-input">
	<input
		{id}
		type="text"
		bind:value={localPart}
		required
		{placeholder}
		autocomplete="off"
		autocapitalize="none"
		spellcheck="false"
		class="local-input"
	/>
	<span class="at">@</span>
	<select bind:value={domainId} class="domain-select" aria-label={t('domains.domain')}>
		{#each domains as domain (domain.id)}
			<option value={domain.id}>{domain.name}</option>
		{/each}
	</select>
</div>

<style>
	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.address-input {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.address-input:focus-within {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.local-input {
		flex: 1;
		min-width: 0;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.at {
		color: var(--color-muted);
	}

	.domain-select {
		max-width: 55%;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		background: transparent;
		outline: none;
		cursor: pointer;
	}
</style>
