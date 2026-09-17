<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';
	import { LABEL_COLORS, MAX_AUTO_LABELS, MAX_LABEL_INSTRUCTIONS, MAX_LABEL_NAME } from '$lib/mail/labels';
	import { parseClassifyCursor, type ClassifyCursor, type ClassifyStep } from '$lib/mail/classify-progress';
	import type { MailLabel } from '$lib/types';

	let { labels }: { labels: MailLabel[] } = $props();

	let classifyEnabled = $state(false);
	let remaining = $state<number | null>(null);
	let classifyTotal = $state(0);
	let currentSubject = $state('');
	let classifying = $state(false);
	let classifyError = $state('');
	let abortClassify: AbortController | null = null;

	const classified = $derived(Math.max(0, classifyTotal - (remaining ?? classifyTotal)));
	const classifyPercent = $derived(
		classifyTotal > 0 ? Math.min(100, Math.round((classified / classifyTotal) * 100)) : 0
	);
	const showSortSection = $derived(classifyEnabled && remaining != null);
	const showSort = $derived(showSortSection && remaining != null && remaining > 0);

	onMount(() => {
		void loadClassifyStatus();
		return () => abortClassify?.abort();
	});

	async function loadClassifyStatus(): Promise<void> {
		try {
			const response = await fetch('/api/settings/classify', { cache: 'no-store' });
			const body = (await response.json()) as {
				enabled?: boolean;
				remaining?: number;
				error?: string;
			};
			if (!response.ok) {
				classifyError = body.error ?? t('common.tryAgain');
				return;
			}
			classifyEnabled = Boolean(body.enabled);
			remaining = typeof body.remaining === 'number' ? body.remaining : 0;
		} catch {
			classifyError = t('common.networkError');
		}
	}

	async function classifyExisting(): Promise<void> {
		if (classifying) return;

		classifyError = '';
		currentSubject = '';
		classifyTotal = remaining ?? 0;
		classifying = true;
		abortClassify?.abort();
		const controller = new AbortController();
		abortClassify = controller;

		try {
			await loadClassifyStatus();
			if (remaining != null) classifyTotal = remaining;
			if (!classifyEnabled || classifyTotal === 0) return;

			let cursor: ClassifyCursor | null = null;
			while (!controller.signal.aborted) {
				const response = await fetch('/api/settings/classify', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ cursor }),
					signal: controller.signal
				});
				const body = (await response.json()) as ClassifyStep & { error?: string };
				if (!response.ok) {
					classifyError = body.error ?? t('common.tryAgain');
					return;
				}

				remaining = body.remaining;
				if (body.subject) currentSubject = body.subject;
				cursor = parseClassifyCursor(body.cursor);

				if (body.complete) {
					currentSubject = '';
					await invalidateAll();
					return;
				}

				if (!cursor) {
					classifyError = t('common.tryAgain');
					return;
				}
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			classifyError = t('common.networkError');
		} finally {
			classifying = false;
			if (abortClassify === controller) abortClassify = null;
		}
	}

	function stopClassify(): void {
		abortClassify?.abort();
	}

	let name = $state('');
	let color = $state<string>(LABEL_COLORS[0]);
	let autoEnabled = $state(false);
	let autoInstructions = $state('');
	let busy = $state(false);
	let error = $state('');
	let editingId = $state('');

	const autoCount = $derived(labels.filter((label) => label.auto_enabled).length);

	function resetForm() {
		name = '';
		color = LABEL_COLORS[0];
		autoEnabled = false;
		autoInstructions = '';
		editingId = '';
	}

	function startEdit(label: MailLabel) {
		editingId = label.id;
		name = label.name;
		color = label.color;
		autoEnabled = label.auto_enabled;
		autoInstructions = label.auto_instructions ?? '';
		error = '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			error = t('settings.labelNameRequired');
			return;
		}
		if (autoEnabled && autoCount >= MAX_AUTO_LABELS && !labels.find((label) => label.id === editingId)?.auto_enabled) {
			error = t('settings.tooManyAutoLabels', { count: MAX_AUTO_LABELS });
			return;
		}

		busy = true;
		error = '';
		try {
			const payload = {
				name: trimmed,
				color,
				autoEnabled,
				autoInstructions: autoEnabled ? autoInstructions.trim() || null : null
			};
			const response = await fetch(editingId ? `/api/labels/${editingId}` : '/api/labels', {
				method: editingId ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const body = (await response.json()) as { error?: string };
			if (!response.ok) {
				error = body.error ?? t('common.tryAgain');
				return;
			}
			resetForm();
			await invalidateAll();
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}

	async function remove(id: string) {
		if (!confirm(t('settings.deleteLabelConfirm'))) return;
		error = '';
		try {
			const response = await fetch(`/api/labels/${id}`, { method: 'DELETE' });
			if (!response.ok) {
				error = t('common.tryAgain');
				return;
			}
			if (editingId === id) resetForm();
			await invalidateAll();
		} catch {
			error = t('common.networkError');
		}
	}
</script>

{#if showSortSection}
	<section class="surface-lg card">
		<h2><Icon name="inbox-unarchive-line" size={18} /> {t('settings.classifyExistingTitle')}</h2>

		{#if classifying}
			<div class="sort-live" role="status" aria-live="polite">
				<div
					class="bar-track"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={classifyPercent}
				>
					<div class="bar-fill active" style="width: {classifyPercent}%"></div>
				</div>
				<div class="sort-meta">
					<span class="frac">
						{t('settings.classifyExistingProgress', { done: classified, total: classifyTotal })}
					</span>
					{#if currentSubject}
						<span class="subject">{currentSubject}</span>
					{/if}
					<button type="button" class="btn-ghost" onclick={stopClassify}>
						{t('settings.classifyExistingStop')}
					</button>
				</div>
			</div>
		{:else if showSort}
			<div class="sort-row">
				<span class="stat-num">{remaining}</span>
				<button type="button" class="btn-primary" onclick={() => void classifyExisting()}>
					{t('settings.classifyExisting')}
				</button>
			</div>
		{:else}
			<p class="caught-up">
				<Icon name="check-line" size={16} />
				{t('settings.classifyExistingCaughtUp')}
			</p>
		{/if}

		{#if classifyError}<p class="error">{classifyError}</p>{/if}
	</section>
{/if}

<section class="surface-lg card">
	<h2><Icon name="price-tag-3-line" size={18} /> {t('nav.labels')}</h2>

	{#if labels.length > 0}
		<ul class="label-list">
			{#each labels as label (label.id)}
				<li>
					<span class="swatch" style="background: {label.color}"></span>
					<span class="label-name">{label.name}</span>
					{#if label.auto_enabled}
						<span class="auto-tag">{t('settings.labelAuto')}</span>
					{/if}
					<button type="button" class="btn-ghost text-xs" onclick={() => startEdit(label)}>
						{t('common.edit')}
					</button>
					<button type="button" class="btn-ghost text-xs danger" onclick={() => remove(label.id)}>
						{t('common.remove')}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="label-form" onsubmit={save}>
		<div class="name-row">
			<label class="field name-field">
				<span class="sr-only">{t('settings.labelName')}</span>
				<input
					type="text"
					bind:value={name}
					maxlength={MAX_LABEL_NAME}
					placeholder={t('settings.labelName')}
					required
				/>
			</label>
			<fieldset class="colors">
				<legend class="sr-only">{t('settings.labelColor')}</legend>
				{#each LABEL_COLORS as swatch (swatch)}
					<label class="color-choice" class:selected={color === swatch}>
						<input type="radio" name="label-color" value={swatch} bind:group={color} />
						<span class="swatch" style="background: {swatch}"></span>
					</label>
				{/each}
			</fieldset>
		</div>

		<label class="auto-row">
			<input type="checkbox" bind:checked={autoEnabled} />
			<span>{t('settings.labelAuto')}</span>
		</label>

		{#if autoEnabled}
			<label class="field">
				<span class="sr-only">{t('settings.labelAutoInstructions')}</span>
				<textarea
					bind:value={autoInstructions}
					maxlength={MAX_LABEL_INSTRUCTIONS}
					rows="2"
					placeholder={t('settings.labelAutoInstructions')}
				></textarea>
			</label>
		{/if}

		<div class="form-actions">
			{#if editingId}
				<button type="button" class="btn-ghost" onclick={resetForm}>{t('common.cancel')}</button>
			{/if}
			<button type="submit" class="btn-primary" disabled={busy}>
				{busy ? t('common.saving') : editingId ? t('common.save') : t('common.create')}
			</button>
		</div>
		{#if error}<p class="error">{error}</p>{/if}
	</form>
</section>

<style>
	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.sort-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
	}

	.stat-num {
		font-size: 1.75rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.caught-up {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 1rem 0 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.sort-live {
		margin-top: 1rem;
	}

	.sort-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
		min-width: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.sort-meta .btn-ghost {
		flex-shrink: 0;
		margin-left: auto;
	}

	.frac {
		flex-shrink: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.subject {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar-track {
		height: 0.35rem;
		border-radius: 999px;
		background: var(--color-line, rgb(0 0 0 / 0.08));
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--color-accent, #2563eb);
		transition: width 0.2s ease-out;
	}

	.bar-fill.active {
		background-image: linear-gradient(
			90deg,
			transparent,
			rgb(255 255 255 / 0.28),
			transparent
		);
		background-size: 1.5rem 100%;
		animation: classify-shimmer 0.9s linear infinite;
	}

	@keyframes classify-shimmer {
		from {
			background-position: 0 0;
		}
		to {
			background-position: 1.5rem 0;
		}
	}

	.label-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}

	.label-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.label-name {
		flex: 1;
		font-size: 0.875rem;
	}

	.auto-tag {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.label-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.name-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.name-field {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.field input,
	.field textarea {
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font: inherit;
		font-weight: 400;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.colors {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		border: none;
		margin: 0;
		padding: 0;
	}

	.color-choice {
		position: relative;
		cursor: pointer;
	}

	.color-choice input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.color-choice .swatch {
		width: 1.25rem;
		height: 1.25rem;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
	}

	.color-choice.selected .swatch {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.auto-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.danger {
		color: var(--color-danger);
	}

	.error {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
