<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n';
	import type { MailAddress, MailLabel } from '$lib/types';
	import { IMPORT_FOLDERS, EXPORT_FOLDERS, type ImportFolder, type ExportFolder, type ImportResult } from '$lib/mail/transfer';

	let { addresses, labels }: { addresses: MailAddress[]; labels: MailLabel[] } = $props();
	let addressId = $state(untrack(() => addresses.find((address) => address.is_default)?.id ?? addresses[0]?.id ?? ''));
	let folder = $state<ImportFolder>('inbox');
	let labelId = $state('');
	let preserveFolders = $state(false);
	let files = $state<FileList>();
	let importing = $state(false);
	let stopped = $state(false);
	let stopRequested = $state(false);
	let currentFile = $state('');
	let total = $state(0);
	let imported = $state(0);
	let skipped = $state(0);
	let failed = $state(0);
	let importError = $state('');
	let completed = $state(false);
	let issues = $state<{ file: string; message: string }[]>([]);
	let controller: AbortController | null = null;
	onDestroy(() => controller?.abort());
	const processed = $derived(imported + skipped + failed);

	async function startImport(event: SubmitEvent) {
		event.preventDefault();
		if (importing) return;
		resetExport();
		importing = true; stopped = false; stopRequested = false; completed = false;
		imported = 0; skipped = 0; failed = 0; total = 0; issues = []; importError = ''; currentFile = '';
		const abort = new AbortController();
		controller = abort;
		let archive: Awaited<ReturnType<typeof import('$lib/mail/import-archive').openImportFiles>> | undefined;
		// Capture options once so each message in this import has the same destination.
		const params = new URLSearchParams({ address: addressId, folder, label: labelId, preserveFolders: String(preserveFolders) });
		try {
			const { openImportFiles } = await import('$lib/mail/import-archive');
			archive = await openImportFiles(Array.from(files ?? []));
			total = archive.messages.length;
			for (const file of archive.messages) {
				if (stopRequested || abort.signal.aborted) { stopped = true; break; }
				currentFile = file.name;
				try {
					const bytes = await file.read(abort.signal);
					params.set('path', file.name);
					const response = await fetch(`/api/settings/mail-import?${params}`, { method: 'POST',
						headers: { 'Content-Type': 'message/rfc822' }, body: bytes, signal: abort.signal });
					const body = await response.json() as ImportResult & { error?: string };
					if (!response.ok) {
						if (response.status === 401 || response.status === 403 || response.status >= 500) stopRequested = true;
						throw new Error(body.error || t('transfer.importFailed'));
					}
					if (body.status === 'skipped') skipped++; else imported++;
					if (body.warning && issues.length < 100) issues.push({ file: file.name, message: body.warning });
				} catch (error) {
					if (abort.signal.aborted) { stopped = true; break; }
					if (error instanceof TypeError) stopRequested = true;
					failed++;
					if (issues.length < 100) issues.push({ file: file.name, message: error instanceof Error ? error.message : t('common.networkError') });
				}
			}
			completed = !stopped;
		} catch (error) {
			importError = error instanceof Error ? error.message : t('transfer.importFailed');
		} finally {
			await archive?.close();
			importing = false; currentFile = ''; controller = null;
			if (!abort.signal.aborted) await invalidateAll();
		}
	}

	let exportAddress = $state('');
	let exportFolder = $state<ExportFolder>('all');
	let exportLabel = $state('');
	let dateMode = $state('all');
	let from = $state('');
	let to = $state('');
	let exporting = $state(false);
	let exportError = $state('');
	let exportReady = $state(false);
	let parts = $state<{ href: string; count: number; downloaded: boolean }[]>([]);
	const exportCount = $derived(parts.reduce((count, part) => count + part.count, 0));

	function resetExport() { parts = []; exportReady = false; exportError = ''; }
	async function prepareExport(event: SubmitEvent) {
		event.preventDefault();
		exporting = true; resetExport();
		const params = new URLSearchParams({ folder: exportFolder, address: exportAddress, label: exportLabel });
		if (dateMode === 'custom') { params.set('from', from); params.set('to', to); }
		else if (dateMode !== 'all') {
			const since = new Date(); since.setUTCDate(since.getUTCDate() - Number(dateMode));
			params.set('from', since.toISOString().slice(0, 10));
		}
		try {
			const response = await fetch(`/api/settings/mail-export?${params}&prepare=true`, { cache: 'no-store' });
			const body = await response.json() as { error?: string; parts: { after: number; through: number; count: number }[] };
			if (!response.ok) throw new Error(body.error || t('transfer.exportFailed'));
			parts = body.parts.map((part) => ({ href: `/api/settings/mail-export?${params}&after=${part.after}&through=${part.through}`, count: part.count, downloaded: false }));
			exportReady = true;
		} catch (error) { exportError = error instanceof Error ? error.message : t('common.networkError'); }
		finally { exporting = false; }
	}
</script>

<p class="intro">{t('transfer.intro')}</p>

<section class="surface-lg card" aria-labelledby="mail-import-title">
	<h2 id="mail-import-title"><Icon name="upload-2-line" size={18} /> {t('transfer.importTitle')}</h2>
	<p class="hint">{t('transfer.importHint')}</p>
	<form onsubmit={startImport}>
		<fieldset disabled={importing}>
			<label class="field upload">
				<span>{t('transfer.files')}</span>
				<input type="file" accept=".eml,.zip,message/rfc822,application/zip" multiple bind:files required />
				<span class="hint">{t('transfer.limits')}</span>
			</label>
			<div class="columns">
				<label class="field"><span>{t('transfer.destinationAddress')}</span>
					<select bind:value={addressId} required>
						<option value="" disabled>{t('transfer.chooseAddress')}</option>
						{#each addresses as address (address.id)}<option value={address.id}>{address.address}</option>{/each}
					</select>
				</label>
				<label class="field"><span>{t('transfer.destinationFolder')}</span>
					<select bind:value={folder}>{#each IMPORT_FOLDERS as item}<option value={item}>{t(`nav.${item}`)}</option>{/each}</select>
				</label>
			</div>
			<label class="field"><span>{t('transfer.applyLabel')}</span>
				<select bind:value={labelId}><option value="">{t('common.none')}</option>{#each labels as label (label.id)}<option value={label.id}>{label.name}</option>{/each}</select>
			</label>
			<label class="check"><input type="checkbox" bind:checked={preserveFolders} /><span>{t('transfer.preserveFolders')}</span></label>
			<p class="hint">{t('transfer.folderHint')}</p>
		</fieldset>
		<div class="actions">
			<button class="btn-primary" type="submit" disabled={importing || !files?.length || !addressId} aria-busy={importing}>
				{importing ? t('transfer.importing') : t('transfer.importTitle')}
			</button>
			{#if importing}<button class="btn-ghost" type="button" disabled={stopRequested} onclick={() => { stopRequested = true; }}>{stopRequested ? t('transfer.stopping') : t('transfer.stop')}</button>{/if}
		</div>
	</form>
	{#if !addresses.length}<p class="hint">{t('transfer.noAddresses')}</p>{/if}
	{#if importing || completed || stopped}
		<div class="result" role="status" aria-live="polite">
			<strong>{importing ? t('transfer.progress', { processed, total }) : stopped ? t('transfer.stopped') : t('transfer.complete')}</strong>
			<p>{t('transfer.counts', { imported, skipped, failed })}</p>
			{#if importing}<progress value={processed} max={total || 1} aria-label={t('transfer.importing')}></progress><p class="filename">{currentFile}</p><p class="hint">{t('transfer.keepOpen')}</p>{/if}
			{#if stopped}<p class="hint">{t('transfer.retryHint')}</p>{/if}
		</div>
	{/if}
	{#if importError}<p class="error" role="alert">{importError}</p>{/if}
	{#if issues.length}
		<details class="issues"><summary>{t('transfer.details')}</summary><ul>{#each issues as issue}<li><strong>{issue.file}</strong><br />{issue.message}</li>{/each}</ul></details>
	{/if}
</section>

<section class="surface-lg card" aria-labelledby="mail-export-title">
	<h2 id="mail-export-title"><Icon name="download-2-line" size={18} /> {t('transfer.exportTitle')}</h2>
	<p class="hint">{t('transfer.exportHint')}</p>
	<form onsubmit={prepareExport} onchange={resetExport}>
		<fieldset disabled={exporting}>
			<div class="columns">
				<label class="field"><span>{t('transfer.address')}</span><select bind:value={exportAddress}><option value="">{t('transfer.allAddresses')}</option>{#each addresses as address (address.id)}<option value={address.id}>{address.address}</option>{/each}</select></label>
				<label class="field"><span>{t('transfer.folder')}</span><select bind:value={exportFolder}>{#each EXPORT_FOLDERS as item}<option value={item}>{item === 'all' ? t('transfer.allFolders') : t(`nav.${item}`)}</option>{/each}</select></label>
			</div>
			<label class="field"><span>{t('transfer.label')}</span><select bind:value={exportLabel}><option value="">{t('transfer.anyLabel')}</option>{#each labels as label (label.id)}<option value={label.id}>{label.name}</option>{/each}</select></label>
			<label class="field"><span>{t('transfer.dateRange')}</span>
				<select bind:value={dateMode}><option value="all">{t('transfer.allDates')}</option><option value="30">{t('transfer.lastDays', { days: 30 })}</option><option value="90">{t('transfer.lastDays', { days: 90 })}</option><option value="365">{t('transfer.lastDays', { days: 365 })}</option><option value="custom">{t('transfer.customDates')}</option></select>
			</label>
			{#if dateMode === 'custom'}<div class="columns">
				<label class="field"><span>{t('transfer.from')}</span><input type="date" bind:value={from} max={to || undefined} required /></label>
				<label class="field"><span>{t('transfer.to')}</span><input type="date" bind:value={to} min={from || undefined} required /></label>
			</div>{/if}
			<p class="hint">{t('transfer.exportLimits')}</p>
		</fieldset>
		<div class="actions"><button class="btn-primary" type="submit" disabled={exporting || importing} aria-busy={exporting}>{exporting ? t('transfer.preparing') : t('transfer.prepare')}</button></div>
	</form>
	{#if exportError}<p class="error" role="alert">{exportError}</p>{/if}
	{#if exportReady}
		<div class="result" role="status">
			{#if parts.length}
				<strong>{t('transfer.exportReady', { count: exportCount, parts: parts.length })}</strong>
				<div class="downloads">{#each parts as part, index}<a class="btn-ghost" href={part.href} download data-sveltekit-reload onclick={() => { part.downloaded = true; }}><Icon name="download-2-line" size={16} />{parts.length === 1 ? t('transfer.download') : t('transfer.downloadPart', { part: index + 1, count: part.count })}{#if part.downloaded}<span class="hint"> · {t('transfer.requested')}</span>{/if}</a>{/each}</div>
				<p class="hint">{t('transfer.reportHint')}</p>
			{:else}<p>{t('transfer.emptyExport')}</p>{/if}
		</div>
	{/if}
</section>

<style>
	.intro { color: var(--color-muted); font-size: 0.875rem; line-height: 1.6; margin: 0.75rem 0 1.5rem; }
	.card { margin-top: 1.5rem; padding: 1.5rem; }
	h2 { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 0.9375rem; font-weight: 600; }
	.hint { color: var(--color-muted); font-size: 0.8125rem; font-weight: 400; line-height: 1.5; margin: 0; }
	h2 + .hint { margin: 0.625rem 0 1.25rem; }
	fieldset { display: flex; flex-direction: column; gap: 1rem; border: 0; padding: 0; margin: 0; min-width: 0; }
	fieldset:disabled { opacity: 0.7; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.8125rem; font-weight: 500; min-width: 0; }
	.field select, .field input { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--color-line); border-radius: 0.5rem; padding: 0.6rem 0.625rem; font: inherit; font-weight: 400; background: var(--color-surface); color: var(--color-text); }
	.field input[type='file'] { border-style: dashed; padding: 1rem; }
	.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
	.check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
	.actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
	.result { margin-top: 1.25rem; padding: 1rem; background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 0.5rem; font-size: 0.8125rem; }
	.result p { margin: 0.5rem 0 0; }
	progress { width: 100%; height: 0.4rem; accent-color: var(--color-accent); }
	.filename { overflow-wrap: anywhere; color: var(--color-muted); }
	.error { margin-top: 1rem; color: var(--color-danger); font-size: 0.8125rem; }
	.issues { margin-top: 1rem; font-size: 0.8125rem; }
	.issues summary { cursor: pointer; }
	.issues ul { padding-left: 1.25rem; max-height: 18rem; overflow: auto; }
	.issues li { margin: 0.75rem 0; overflow-wrap: anywhere; }
	.downloads { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; margin: 0.75rem 0; }
	.downloads a { display: inline-flex; align-items: center; gap: 0.5rem; }
	@media (max-width: 600px) { .columns { grid-template-columns: 1fr; } .card { padding: 1.25rem 1rem; } }
</style>
