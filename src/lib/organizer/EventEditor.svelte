<script lang="ts">
	import { untrack, onMount, onDestroy } from 'svelte';
	import type { CalendarEvent } from './types';
	import type { MailAddress } from '$lib/types';
	import { eventTimes, shiftDate } from './dates';
	import { organizerRequest } from './client';
	import { contactSuggestions } from './contact-suggestions';
	let {
		event = null,
		addresses,
		date,
		timeZone,
		seed,
		events,
		onSave,
		onClose
	}: {
		event?: CalendarEvent | null;
		addresses: MailAddress[];
		date: string;
		timeZone: string;
		seed?: { title: string; description: string; sourceEmailId: string | null; guests: string };
		events: CalendarEvent[];
		onSave: (event: CalendarEvent) => void;
		onClose: () => void;
	} = $props();
	const original = untrack(() => event),
		initial = untrack(() => seed);
	const id = original?.id ?? crypto.randomUUID();
	let title = $state(original?.title || initial?.title || '');
	let description = $state(original?.description || initial?.description || '');
	let location = $state(original?.location || '');
	let allDay = $state(original?.allDay ?? false);
	let start = $state(original?.startLocal ?? `${untrack(() => date)}T09:00`);
	let end = $state(
		original
			? original.allDay
				? shiftDate(original.endLocal, -1)
				: original.endLocal
			: `${untrack(() => date)}T10:00`
	);
	let zone = $state(original?.timeZone ?? untrack(() => timeZone));
	let guests = $state(original?.guests.map((g) => g.email).join(', ') ?? initial?.guests ?? '');
	let fromAddressId = $state(
		original?.fromAddressId ??
			untrack(() => addresses.find((a) => a.is_default)?.id || addresses[0]?.id || '')
	);
	let reminder = $state(
		original?.reminderMinutes === null ? 'none' : String(original?.reminderMinutes ?? 10)
	);
	let color = $state(original?.color || '#729681');
	let busy = $state(false),
		error = $state('');
	let alive = true;
	onDestroy(() => {
		alive = false;
	});
	let notices = $state<
		{
			id: string;
			recipient: string;
			state: string;
			email_id: string | null;
			last_error: string | null;
			delivery_status: string | null;
		}[]
	>([]);
	let zones = $state<string[]>(['UTC']);
	const readOnly = Boolean(original && (!original.owned || original.cancelled));
	let detailVersion = $state(original?.version ?? 0);
	onMount(() => {
		zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];
		if (original)
			void organizerRequest(`/api/calendar/${original.id}`)
				.then((result) => {
					notices = result.notices;
				})
				.catch((cause) => (error = cause.message));
	});
	const overlap = $derived.by(() => {
		if (readOnly) return [];
		try {
			const times = eventTimes(start, allDay ? shiftDate(end, 1) : end, zone, allDay);
			return events.filter(
				(e) =>
					e.id !== id &&
					e.response !== 'DECLINED' &&
					e.startsAt < times.endsAt &&
					e.endsAt > times.startsAt
			);
		} catch {
			return [];
		}
	});
	function toggleAllDay(e: Event) {
		allDay = (e.currentTarget as HTMLInputElement).checked;
		start = allDay ? start.slice(0, 10) : `${start.slice(0, 10)}T09:00`;
		end = allDay ? end.slice(0, 10) : `${end.slice(0, 10)}T10:00`;
	}
	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const result = await organizerRequest<{ event: CalendarEvent }>(
				original ? `/api/calendar/${id}` : '/api/calendar',
				original ? 'PUT' : 'POST',
				{
					id,
					version: original?.version,
					title,
					description,
					location,
					startLocal: start,
					endLocal: allDay ? shiftDate(end, 1) : end,
					timeZone: zone,
					allDay,
					color,
					guests: guests
						.split(',')
						.map((email) => email.trim())
						.filter(Boolean)
						.map((email) => ({ email, name: '' })),
					fromAddressId,
					sourceEmailId: original?.sourceEmailId ?? initial?.sourceEmailId ?? null,
					reminderMinutes: reminder === 'none' ? null : Number(reminder)
				}
			);
			if (alive) onSave(result.event);
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function cancel() {
		if (
			!original ||
			!confirm(
				original.guests.length
					? 'Cancel this event and send cancellation emails to all guests?'
					: 'Delete this event from your calendar?'
			)
		)
			return;
		busy = true;
		error = '';
		try {
			const result = await organizerRequest<{ event: CalendarEvent }>(
				`/api/calendar/${id}`,
				'DELETE',
				{ version: original.version }
			);
			if (alive) onSave(result.event);
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function saveReminder() {
		busy = true;
		error = '';
		try {
			const result = await organizerRequest<{ event: CalendarEvent }>(
				`/api/calendar/${id}`,
				'PATCH',
				{ version: detailVersion, reminderMinutes: reminder === 'none' ? null : Number(reminder) }
			);
			detailVersion = result.event.version;
			if (alive) onSave(result.event);
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function retry() {
		try {
			await organizerRequest(`/api/calendar/${id}`, 'PATCH', { retryNotices: true });
			notices = (await organizerRequest(`/api/calendar/${id}`)).notices;
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
</script>

<section class="editor event-editor" aria-label="Event details">
	<div class="editor-head">
		<h2>{original ? (original.cancelled ? 'Cancelled event' : 'Event details') : 'New event'}</h2>
		<button aria-label="Close event" onclick={onClose}>✕</button>
	</div>
	{#if error}<p class="notice error" role="alert">{error}</p>{/if}
	{#if readOnly}
		<h2>{title}</h2>
		<p>
			{allDay ? start : start.replace('T', ' ')} — {allDay ? end : end.replace('T', ' ')}<br /><span
				class="subtle">{zone}{allDay ? ' · All day' : ''}</span
			>
		</p>
		<p class="subtle">
			Organizer: {original?.organizer.name || original?.organizer.email}<br />{original?.organizer
				.email}
		</p>
		{#if location}<p>{location}</p>{/if}{#if description}<p class="description">
				{description}
			</p>{/if}
		{#if !original?.cancelled}<p>
				Your response: <strong
					>{original?.response.replace('NEEDS-ACTION', 'Not yet responded').toLowerCase()}</strong
				>
			</p>
			<label
				>Reminder<select bind:value={reminder}
					><option value="none">No reminder</option><option value="0">At event time</option><option
						value="10">10 minutes before</option
					><option value="30">30 minutes before</option><option value="60">1 hour before</option
					><option value="1440">1 day before</option></select
				></label
			><button disabled={busy} onclick={saveReminder}>Save reminder</button>
		{/if}
	{:else}
		<form onsubmit={save}>
			<label
				>Event title<input
					bind:value={title}
					maxlength="180"
					required
					placeholder="Add a title"
				/></label
			>
			<label class="check"
				><input type="checkbox" bind:checked={allDay} onchange={toggleAllDay} />All day</label
			>
			<div class="form-grid">
				<label
					>Start<input
						type={allDay ? 'date' : 'datetime-local'}
						bind:value={start}
						required
					/></label
				><label
					>End<input type={allDay ? 'date' : 'datetime-local'} bind:value={end} required /></label
				>
				<label class="wide"
					>Time zone<input bind:value={zone} list="event-timezones" required /><datalist
						id="event-timezones"
						>{#each zones as tz}<option value={tz}></option>{/each}</datalist
					></label
				>
			</div>
			{#if overlap.length}<p class="conflict">
					Overlaps {overlap.length}
					{overlap.length === 1 ? 'event' : 'events'} on your calendar: {overlap
						.map((e) => e.title)
						.join(', ')}
				</p>{/if}
			<label
				>Guests<input
					use:contactSuggestions
					bind:value={guests}
					placeholder="Add email addresses"
				/><span class="subtle"
					>Separate guests with commas. Saving sends invitations or updates.</span
				></label
			>
			{#if !original}<label
					>Organizer<select bind:value={fromAddressId} required
						>{#each addresses as address}<option value={address.id}>{address.address}</option
							>{/each}</select
					></label
				>{/if}
			<label
				>Location<input
					bind:value={location}
					maxlength="500"
					placeholder="Place or meeting link"
				/></label
			>
			<label>Description<textarea bind:value={description} maxlength="8000"></textarea></label>
			<div class="form-grid">
				<label
					>Reminder<select bind:value={reminder}
						><option value="none">No reminder</option><option value="0">At event time</option
						><option value="10">10 minutes before</option><option value="30"
							>30 minutes before</option
						><option value="60">1 hour before</option><option value="1440">1 day before</option
						></select
					></label
				><label>Event color<input type="color" bind:value={color} /></label>
			</div>
			<div class="actions">
				<button class="primary" disabled={busy || !fromAddressId}
					>{busy ? 'Saving…' : guests.trim() ? 'Save & send invitations' : 'Save event'}</button
				>{#if original}<button type="button" class="danger" disabled={busy} onclick={cancel}
						>{original.guests.length ? 'Cancel event' : 'Delete event'}</button
					>{/if}
			</div>
		</form>
	{/if}
	{#if original}
		<div class="inline-links">
			<a href={`/api/calendar/${id}?download=1`} download>Download .ics</a
			>{#if original.sourceEmailId}<a href={`/mail/${original.sourceEmailId}`}
					>Open email{!original.owned && !original.cancelled ? ' / respond' : ''}</a
				>{/if}
		</div>
		{#if original.guests.length}<details>
				<summary>Guests ({original.guests.length})</summary>
				<ul>
					{#each original.guests as guest}<li>
							{guest.name || guest.email}<span class="subtle"
								>{guest.status === 'NEEDS-ACTION'
									? 'Awaiting response'
									: guest.status.toLowerCase()}</span
							>
						</li>{/each}
				</ul>
			</details>{/if}
		{#if notices.length}<details>
				<summary>Invitation delivery</summary>
				<ul>
					{#each notices as notice}<li>
							<span>{notice.recipient}</span>{#if notice.email_id}<a
									href={`/mail/${notice.email_id}`}>{notice.delivery_status || 'In Outbox'}</a
								>{:else}<span class="subtle"
									>{notice.state === 'pending' ? 'Preparing' : notice.last_error}</span
								>{/if}
						</li>{/each}
				</ul>
				{#if notices.some((n) => n.state === 'failed')}<button onclick={retry}
						>Retry invitation delivery</button
					>{/if}<a class="subtle" href="/outbox">Open Outbox</a>
			</details>{/if}
	{/if}
</section>

<style>
	.event-editor {
		background: var(--color-surface);
		border-left: 1px solid var(--color-line);
	}
	.description {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 14px;
	}
	.conflict {
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--tone-warn-bg);
		color: var(--tone-warn-fg);
		font-size: 12px;
	}
	summary {
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
	}
	ul {
		display: grid;
		gap: 10px;
		padding: 12px 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	li a {
		text-decoration: underline;
	}
	input[type='color'] {
		width: 100%;
		height: 38px;
		border: 1px solid var(--color-line);
		border-radius: 8px;
		background: transparent;
		padding: 4px;
	}
</style>
