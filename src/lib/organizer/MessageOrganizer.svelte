<script lang="ts">
	import { onMount } from 'svelte';
	import type { ThreadMessage } from '$lib/types';
	import type { CalendarInvitation } from './types';
	import { organizerRequest } from './client';
	import { parseAddressList } from '$lib/mail/folders';
	import { shiftDate } from './dates';
	let { message }: { message: ThreadMessage } = $props();
	let invitations = $state<CalendarInvitation[]>([]),
		warnings = $state<string[]>([]),
		busy = $state(false),
		error = $state(''),
		notice = $state('');
	const sender = $derived(parseAddressList(message.from_addr)[0]);
	const hasCalendar = $derived(
		message.attachments.some(
			(a) =>
				a.filename.toLowerCase().endsWith('.ics') ||
				a.content_type.toLowerCase().startsWith('text/calendar')
		)
	);
	let timeZone = $state('UTC');
	async function load() {
		try {
			const result = await organizerRequest<{
				invitations: CalendarInvitation[];
				warnings: string[];
			}>(`/api/mail/${message.id}/invitations?timeZone=${encodeURIComponent(timeZone)}`);
			invitations = result.invitations;
			warnings = result.warnings;
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
	onMount(() => {
		timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		if (hasCalendar) void load();
	});
	async function respond(invitation: CalendarInvitation, response: string) {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await organizerRequest(`/api/mail/${message.id}/invitations`, 'POST', {
				attachmentId: invitation.attachmentId,
				response,
				version: invitation.existingVersion ?? 0,
				timeZone
			});
			notice = response === 'APPLY' ? 'Calendar updated.' : 'Response saved and queued in Outbox.';
			await load();
		} catch (cause) {
			error = (cause as Error).message;
			await load();
		} finally {
			busy = false;
		}
	}
</script>

<div class="message-organizer">
	<div class="links">
		<a href={`/calendar?email=${encodeURIComponent(message.id)}`}>Create event</a
		>{#if sender && message.direction === 'inbound'}<a
				href={`/contacts?email=${encodeURIComponent(sender.email)}&name=${encodeURIComponent(message.from_name || sender.name)}`}
				>Save contact</a
			>{/if}
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}{#if notice}<p role="status">
			{notice}
		</p>{/if}
	{#each warnings as warning}<p class="warning">{warning}</p>{/each}
	{#each invitations as invitation (invitation.attachmentId)}
		<section class="invitation" aria-label="Calendar invitation">
			<div class="invitation-label">
				{invitation.method === 'CANCEL'
					? 'Event cancellation'
					: invitation.method === 'REPLY'
						? 'Guest response'
						: 'Calendar invitation'}
			</div>
			<h3>{invitation.event.title}</h3>
			<p>
				{invitation.event.allDay
					? invitation.event.startLocal
					: new Date(invitation.event.startsAt).toLocaleString()} – {invitation.event.allDay
					? shiftDate(invitation.event.endLocal, -1)
					: new Date(invitation.event.endsAt).toLocaleString()}
			</p>
			<p class="muted">
				{invitation.event.allDay ? 'All day' : timeZone}{invitation.event.location
					? ` · ${invitation.event.location}`
					: ''}
			</p>
			{#if invitation.event.organizer.email}<p class="muted">
					Organizer: {invitation.event.organizer.email}
				</p>{/if}
			{#if invitation.method === 'REPLY'}<p>
					{invitation.event.guests[0]?.email}: {invitation.event.guests[0]?.status.toLowerCase()}
				</p>{/if}
			{#if invitation.warning}<p class="warning">
					{invitation.warning}
				</p>{:else if invitation.canRespond}
				<div class="responses">
					{#if invitation.method === 'REQUEST'}<button
							disabled={busy}
							class:chosen={invitation.response === 'ACCEPTED'}
							onclick={() => respond(invitation, 'ACCEPTED')}>Accept</button
						><button
							disabled={busy}
							class:chosen={invitation.response === 'TENTATIVE'}
							onclick={() => respond(invitation, 'TENTATIVE')}>Maybe</button
						><button
							disabled={busy}
							class:chosen={invitation.response === 'DECLINED'}
							onclick={() => respond(invitation, 'DECLINED')}>Decline</button
						>{:else}<button disabled={busy} onclick={() => respond(invitation, 'APPLY')}
							>{invitation.method === 'CANCEL'
								? 'Remove from calendar'
								: 'Update guest response'}</button
						>{/if}
				</div>
			{/if}
			{#if invitation.existingId}<a href={`/calendar?event=${invitation.existingId}`}
					>Open in Calendar</a
				>{/if}
		</section>
	{/each}
</div>

<style>
	.message-organizer {
		margin: 12px 0 18px;
		font-size: 12px;
		color: var(--color-text);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		color: var(--color-text-secondary);
	}
	a {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.invitation {
		margin-top: 14px;
		padding: 18px;
		border: 1px solid var(--color-focus-line);
		background: var(--color-surface-muted);
		border-radius: 12px;
		display: grid;
		gap: 7px;
	}
	.invitation-label {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 10px;
		color: var(--color-text-secondary);
	}
	h3 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}
	p {
		margin: 4px 0;
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--color-text-secondary);
	}
	.error,
	.warning {
		color: var(--color-danger);
	}
	.responses {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 8px 0;
	}
	button {
		padding: 7px 16px;
		border-radius: 7px;
		border: 1px solid var(--color-focus-line);
		cursor: pointer;
		background: var(--color-surface);
	}
	button.chosen {
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
	button:disabled {
		opacity: 0.5;
	}
</style>
