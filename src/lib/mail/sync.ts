export const MAIL_CHANGED_MESSAGE = 'mail:changed';
export const MAILBOX_SYNC_PATH = '/api/mail/sync';
/** Stay under the Workers HTTP wall-clock limit so the hold can finish cleanly. */
export const MAILBOX_SYNC_HOLD_MS = 20_000;
export const MAILBOX_SYNC_TICK_MS = 1_000;
export const MAILBOX_SYNC_RETRY_MS = 2_000;

export function mailboxSyncUrl(cursor: string | null): string {
	if (!cursor) return MAILBOX_SYNC_PATH;
	return `${MAILBOX_SYNC_PATH}?cursor=${encodeURIComponent(cursor)}`;
}

export function readMailboxCursor(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const cursor = (body as { cursor?: unknown }).cursor;
	return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

export function shouldRefreshMailbox(previous: string | null, next: string): boolean {
	return previous !== null && previous !== next;
}

export function isMailChangedMessage(data: unknown): boolean {
	return (
		typeof data === 'object' &&
		data !== null &&
		(data as { type?: unknown }).type === MAIL_CHANGED_MESSAGE
	);
}

/** Resolves false when the wait was aborted, so callers can stop without throwing. */
export async function waitForAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return false;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
	return !signal.aborted;
}
