<script lang="ts">
	import { onMount } from 'svelte';
	import type { CalendarReminder } from './types';
	import { organizerRequest } from './client';
	let reminders = $state<CalendarReminder[]>([]),
		error = $state('');
	onMount(() => {
		let active = true;
		async function refresh() {
			if (document.visibilityState !== 'visible') return;
			try {
				const data = await organizerRequest<{ reminders: CalendarReminder[] }>(
					'/api/calendar/reminders'
				);
				if (active) reminders = data.reminders;
			} catch {
				/* Reconnect on the next poll. */
			}
		}
		void refresh();
		const timer = setInterval(refresh, 60_000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			active = false;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
	async function dismiss(id: string) {
		try {
			await organizerRequest('/api/calendar/reminders', 'POST', { id });
			reminders = reminders.filter((r) => r.id !== id);
			error = '';
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
</script>

{#if reminders.length}<aside
		class="calendar-reminders"
		aria-label="Calendar reminders"
		aria-live="polite"
	>
		{#each reminders.slice(0, 3) as reminder (reminder.id)}<div class="reminder">
				<div>
					<span>Calendar reminder</span><a href={`/calendar?event=${reminder.event_id}`}
						>{reminder.title}</a
					><small>{new Date(reminder.starts_at).toLocaleString()}</small>
				</div>
				<button
					onclick={() => dismiss(reminder.id)}
					aria-label={`Dismiss reminder for ${reminder.title}`}>✕</button
				>
			</div>{/each}{#if error}<p role="alert">{error}</p>{/if}
	</aside>{/if}

<style>
	.calendar-reminders {
		position: fixed;
		z-index: 150;
		right: 20px;
		bottom: 20px;
		width: min(350px, calc(100vw - 32px));
		display: grid;
		gap: 8px;
	}
	.reminder {
		display: flex;
		align-items: start;
		gap: 16px;
		justify-content: space-between;
		padding: 16px;
		border: 1px solid var(--color-focus-line);
		border-radius: 12px;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-md);
	}
	.reminder div {
		display: grid;
		gap: 4px;
	}
	span,
	small {
		font-size: 11px;
		color: var(--color-text-secondary);
	}
	a {
		font-size: 14px;
		font-weight: 600;
		text-decoration: underline;
	}
	button {
		cursor: pointer;
		padding: 4px;
	}
	p {
		background: var(--color-surface);
		color: var(--color-danger);
		padding: 8px;
		font-size: 12px;
	}
	@media (max-width: 900px) {
		.calendar-reminders {
			right: 16px;
			bottom: calc(76px + env(safe-area-inset-bottom));
		}
	}
</style>
