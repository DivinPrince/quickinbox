<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';

	type Kind = 'workers_ai' | 'openai' | 'anthropic';
	type Provider = { kind: Kind; base_url: string | null; model: string; key_hint: string | null };
	type Settings = {
		provider: Provider | null;
		/** What a user without their own key drafts with. */
		fallback?: { kind: Kind; model: string } | null;
		canStoreKeys: boolean;
		workersAiAvailable?: boolean;
	};

	/** `user`: the signed-in person's own key. `instance`: the admin's default for everyone. */
	let { scope }: { scope: 'user' | 'instance' } = $props();

	const endpoint = $derived(scope === 'instance' ? '/api/admin/ai' : '/api/settings/ai');

	const MODEL_PLACEHOLDERS: Record<Kind, string> = {
		workers_ai: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
		openai: 'gpt-5-mini',
		anthropic: 'claude-opus-5'
	};

	let settings = $state<Settings | null>(null);
	let kind = $state<Kind>('openai');
	let baseUrl = $state('');
	let model = $state('');
	let apiKey = $state('');
	let busy = $state(false);
	let testing = $state(false);
	let error = $state('');
	let notice = $state('');

	const kinds = $derived<Kind[]>(
		scope === 'instance' && settings?.workersAiAvailable
			? ['workers_ai', 'openai', 'anthropic']
			: ['openai', 'anthropic']
	);
	const needsKey = $derived(kind !== 'workers_ai');
	const savedKeyHint = $derived(
		settings?.provider?.kind === kind ? settings.provider.key_hint : null
	);

	function kindLabel(value: Kind): string {
		switch (value) {
			case 'workers_ai':
				return t('ai.kindWorkersAi');
			case 'openai':
				return t('ai.kindOpenai');
			case 'anthropic':
				return t('ai.kindAnthropic');
			default: {
				const _never: never = value;
				return _never;
			}
		}
	}

	const status = $derived.by(() => {
		if (!settings) return '';
		const own = settings.provider;
		if (scope === 'instance') {
			return own
				? t('ai.instanceActive', { provider: kindLabel(own.kind), model: own.model })
				: t('ai.instanceOff');
		}
		if (own) return t('ai.usingOwn', { provider: kindLabel(own.kind), model: own.model });
		if (settings.fallback) {
			return t('ai.usingInstance', {
				provider: kindLabel(settings.fallback.kind),
				model: settings.fallback.model
			});
		}
		return t('ai.notSetUp');
	});

	onMount(() => {
		void load();
	});

	function fill(provider: Provider | null) {
		kind = provider?.kind ?? kinds[0];
		baseUrl = provider?.base_url ?? '';
		model = provider?.model ?? '';
		apiKey = '';
	}

	/**
	 * Switching provider must not carry the old one's details over: saving would
	 * send the new key to the old address, or a key typed for one provider to the
	 * other. Switching back restores what is saved.
	 */
	function chooseKind(next: Kind) {
		if (next === kind) return;
		kind = next;
		const saved = settings?.provider?.kind === next ? settings.provider : null;
		baseUrl = saved?.base_url ?? '';
		model = saved?.model ?? '';
		apiKey = '';
	}

	async function load(): Promise<void> {
		try {
			const response = await fetch(endpoint, { cache: 'no-store' });
			const body = (await response.json()) as Settings & { error?: string };
			if (!response.ok) {
				error = body.error ?? t('common.tryAgain');
				return;
			}
			settings = body;
			fill(body.provider);
		} catch {
			error = t('common.networkError');
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		notice = '';
		try {
			const response = await fetch(endpoint, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind, baseUrl, model, apiKey })
			});
			const body = (await response.json()) as { provider?: Provider; error?: string };
			if (!response.ok || !body.provider) {
				error = body.error ?? t('common.tryAgain');
				return;
			}
			settings = { ...settings!, provider: body.provider };
			fill(body.provider);
			notice = t('ai.saved');
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}

	async function test() {
		testing = true;
		error = '';
		notice = '';
		try {
			const response = await fetch(`${endpoint}/test`, { method: 'POST' });
			const body = (await response.json()) as { model?: string; reply?: string; error?: string };
			if (!response.ok) {
				error = body.error ?? t('common.tryAgain');
				return;
			}
			notice = t('ai.testPassed', { model: body.model ?? '', reply: body.reply ?? '' });
		} catch {
			error = t('common.networkError');
		} finally {
			testing = false;
		}
	}

	async function remove() {
		if (!confirm(scope === 'instance' ? t('ai.removeInstanceConfirm') : t('ai.removeOwnConfirm'))) {
			return;
		}
		error = '';
		notice = '';
		try {
			const response = await fetch(endpoint, { method: 'DELETE' });
			if (!response.ok) {
				error = t('common.tryAgain');
				return;
			}
			settings = { ...settings!, provider: null };
			fill(null);
		} catch {
			error = t('common.networkError');
		}
	}
</script>

<section class="surface-lg card">
	<h2>
		<Icon name="sparkling-line" size={18} />
		{scope === 'instance' ? t('ai.instanceTitle') : t('ai.title')}
	</h2>
	<p class="card-hint">{scope === 'instance' ? t('ai.instanceHint') : t('ai.userHint')}</p>
	{#if status}<p class="status" role="status">{status}</p>{/if}

	{#if settings}
		<form class="ai-form" onsubmit={save}>
			<fieldset class="kinds">
				<legend class="sr-only">{t('ai.provider')}</legend>
				{#each kinds as option (option)}
					<label class="kind" class:selected={kind === option}>
						<input
							type="radio"
							name="ai-kind-{scope}"
							value={option}
							checked={kind === option}
							onchange={() => chooseKind(option)}
						/>
						{kindLabel(option)}
					</label>
				{/each}
			</fieldset>

			<p class="field-hint">
				{#if kind === 'workers_ai'}
					{t('ai.workersAiHint')}
				{:else if kind === 'openai'}
					{t('ai.openaiHint')}
				{:else}
					{t('ai.anthropicHint')}
				{/if}
			</p>

			{#if kind !== 'workers_ai'}
				<label class="field">
					<span>{t('ai.baseUrl')}</span>
					<input
						type="url"
						bind:value={baseUrl}
						required={kind === 'openai'}
						placeholder={kind === 'openai'
							? 'https://api.openai.com/v1'
							: t('ai.baseUrlOptional')}
						autocomplete="off"
					/>
				</label>
			{/if}

			<label class="field">
				<span>{t('ai.model')}</span>
				<input
					type="text"
					bind:value={model}
					required={kind === 'openai'}
					placeholder={MODEL_PLACEHOLDERS[kind]}
					autocomplete="off"
				/>
			</label>

			{#if needsKey}
				<label class="field">
					<span>{t('ai.apiKey')}</span>
					<input
						type="password"
						bind:value={apiKey}
						required={!savedKeyHint}
						placeholder={savedKeyHint ? t('ai.keepKey', { hint: savedKeyHint }) : ''}
						autocomplete="off"
					/>
				</label>
				{#if !settings.canStoreKeys}
					<p class="field-hint warn">
						{scope === 'instance' ? t('ai.noEncryptionKeyAdmin') : t('ai.noEncryptionKey')}
					</p>
				{/if}
			{/if}

			<div class="actions">
				{#if settings.provider}
					<button type="button" class="btn-ghost text-xs danger" onclick={() => void remove()}>
						{t('common.remove')}
					</button>
					<button type="button" class="btn-ghost" disabled={testing} onclick={() => void test()}>
						{testing ? t('ai.testing') : t('ai.test')}
					</button>
				{/if}
				<button type="submit" class="btn-primary" disabled={busy}>
					{busy ? t('common.saving') : t('common.save')}
				</button>
			</div>
		</form>
	{/if}

	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint,
	.field-hint {
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.status {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.ai-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: none;
	}

	.kind {
		position: relative;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: 999px;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.kind input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.kind.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.field input {
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font: inherit;
		font-weight: 400;
		background: var(--color-surface);
		color: var(--color-text);
		min-width: 0;
	}

	.warn {
		color: var(--color-danger);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.danger {
		color: var(--color-danger);
		margin-right: auto;
	}

	.notice,
	.error {
		margin: 0.75rem 0 0;
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}

	.error {
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.card {
			padding: 1.25rem 1rem;
		}
	}
</style>
