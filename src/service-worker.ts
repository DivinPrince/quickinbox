/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

export {};

type PushPayload = {
	title?: unknown;
	body?: unknown;
	tag?: unknown;
	url?: unknown;
};

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => {
	void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(worker.clients.claim());
});

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readPushPayload(event: PushEvent): PushPayload {
	if (!event.data) return {};
	try {
		const value = event.data.json();
		return typeof value === 'object' && value !== null ? (value as PushPayload) : {};
	} catch {
		return {};
	}
}

async function currentAccountOwnsSubscription(): Promise<boolean> {
	try {
		const subscription = await worker.registration.pushManager.getSubscription();
		if (!subscription) return false;
		const endpoint = encodeURIComponent(subscription.endpoint);
		const response = await fetch(`/api/push/subscriptions?endpoint=${endpoint}`, {
			cache: 'no-store',
			credentials: 'same-origin'
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { registered?: unknown };
		return body.registered === true;
	} catch {
		// Prefer dropping an alert over exposing one account's mail on another
		// account's session when ownership cannot be verified.
		return false;
	}
}

worker.addEventListener('push', (event: PushEvent) => {
	const payload = readPushPayload(event);
	const url = stringValue(payload.url, '/inbox');

	event.waitUntil(
		(async () => {
			if (!(await currentAccountOwnsSubscription())) return;
			await worker.registration.showNotification(stringValue(payload.title, 'New message'), {
				body: stringValue(payload.body, 'You received a new email.'),
				icon: '/icons/icon-192.png',
				badge: '/icons/icon-192.png',
				tag: stringValue(payload.tag, 'quickinbox-new-message'),
				data: { url }
			});
		})()
	);
});

worker.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const requested = stringValue((event.notification.data as { url?: unknown } | null)?.url, '/inbox');
	const requestedDestination = new URL(requested, worker.location.origin);
	const destination =
		requestedDestination.origin === worker.location.origin
			? requestedDestination
			: new URL('/inbox', worker.location.origin);

	event.waitUntil(
		(async () => {
			const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				const windowClient = client as WindowClient;
				if (new URL(windowClient.url).origin !== worker.location.origin) continue;
				try {
					await windowClient.navigate(destination.href);
					await windowClient.focus();
					return;
				} catch {
					await worker.clients.openWindow(destination.href);
					return;
				}
			}
			await worker.clients.openWindow(destination.href);
		})()
	);
});
