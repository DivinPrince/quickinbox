import {
	isMailChangedMessage,
	MAIL_CHANGED_MESSAGE,
	MAILBOX_SYNC_RETRY_MS,
	mailboxSyncUrl,
	readMailboxCursor,
	shouldRefreshMailbox,
	waitForAbortable
} from './sync';

type CursorFetch =
	| { kind: 'ok'; cursor: string }
	| { kind: 'retry' }
	| { kind: 'stop' };

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';
}

async function fetchMailboxCursor(
	cursor: string | null,
	signal: AbortSignal
): Promise<CursorFetch> {
	const response = await fetch(mailboxSyncUrl(cursor), {
		signal,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { Accept: 'application/json' }
	});

	if (response.status === 401 || response.status === 403) return { kind: 'stop' };
	if (!response.ok) return { kind: 'retry' };

	const next = readMailboxCursor(await response.json());
	return next ? { kind: 'ok', cursor: next } : { kind: 'retry' };
}

function waitUntilVisible(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		if (document.visibilityState === 'visible') {
			resolve();
			return;
		}

		const onAbort = () => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		const onVisibility = () => {
			if (document.visibilityState !== 'visible') return;
			cleanup();
			resolve();
		};
		const cleanup = () => {
			signal.removeEventListener('abort', onAbort);
			document.removeEventListener('visibilitychange', onVisibility);
		};

		signal.addEventListener('abort', onAbort);
		document.addEventListener('visibilitychange', onVisibility);
	});
}

/**
 * Keep the open mailbox in sync with inbound delivery. Long-polls a cursor,
 * pauses in background tabs, and wakes immediately on a push message.
 */
export function startMailboxLiveSync(invalidate: () => Promise<void>): () => void {
	if (typeof document === 'undefined') return () => {};

	const lifecycle = new AbortController();
	let poll: AbortController | null = null;

	const stopPoll = () => {
		poll?.abort();
		poll = null;
	};

	const run = async () => {
		let cursor: string | null = null;

		while (!lifecycle.signal.aborted) {
			if (document.visibilityState !== 'visible') {
				try {
					await waitUntilVisible(lifecycle.signal);
				} catch (error) {
					if (isAbortError(error)) return;
					throw error;
				}
				continue;
			}

			poll = new AbortController();
			const onLifecycleAbort = () => poll?.abort();
			lifecycle.signal.addEventListener('abort', onLifecycleAbort);

			try {
				const result = await fetchMailboxCursor(cursor, poll.signal);
				switch (result.kind) {
					case 'ok':
						if (shouldRefreshMailbox(cursor, result.cursor)) {
							cursor = result.cursor;
							await invalidate();
							window.dispatchEvent(new Event(MAIL_CHANGED_MESSAGE));
						} else {
							cursor = result.cursor;
						}
						break;
					case 'retry':
						await waitForAbortable(MAILBOX_SYNC_RETRY_MS, poll.signal);
						break;
					case 'stop':
						await new Promise<void>((resolve) => {
							if (lifecycle.signal.aborted) {
								resolve();
								return;
							}
							lifecycle.signal.addEventListener('abort', () => resolve(), { once: true });
						});
						return;
					default: {
						const _never: never = result;
						return _never;
					}
				}
			} catch (error) {
				if (lifecycle.signal.aborted) return;
				if (!isAbortError(error)) {
					await waitForAbortable(MAILBOX_SYNC_RETRY_MS, lifecycle.signal);
				}
			} finally {
				lifecycle.signal.removeEventListener('abort', onLifecycleAbort);
				poll = null;
			}
		}
	};

	const wake = () => {
		stopPoll();
	};

	const onPageShow = (event: PageTransitionEvent) => {
		if (event.persisted) wake();
	};

	document.addEventListener('visibilitychange', wake);
	window.addEventListener('online', wake);
	window.addEventListener('pageshow', onPageShow);

	const onMessage = (event: MessageEvent) => {
		if (!isMailChangedMessage(event.data)) return;
		stopPoll();
	};
	navigator.serviceWorker?.addEventListener('message', onMessage);

	void run();

	return () => {
		lifecycle.abort();
		stopPoll();
		document.removeEventListener('visibilitychange', wake);
		window.removeEventListener('online', wake);
		window.removeEventListener('pageshow', onPageShow);
		navigator.serviceWorker?.removeEventListener('message', onMessage);
	};
}
