import { SERVICE_WORKER_URL } from './app-chrome';

export function supportsWebPush(): boolean {
	return (
		typeof window !== 'undefined' &&
		'Notification' in window &&
		'serviceWorker' in navigator &&
		'PushManager' in window
	);
}

export function base64UrlToApplicationServerKey(value: string): ArrayBuffer {
	const padding = '='.repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

export function applicationServerKeyMatches(
	current: ArrayBuffer | null,
	publicKey: string
): boolean {
	if (!current) return false;
	const expected = new Uint8Array(base64UrlToApplicationServerKey(publicKey));
	const actual = new Uint8Array(current);
	return actual.byteLength === expected.byteLength && actual.every((byte, index) => byte === expected[index]);
}

export function subscriptionUsesPublicKey(
	subscription: PushSubscription,
	publicKey: string
): boolean {
	return applicationServerKeyMatches(subscription.options.applicationServerKey, publicKey);
}

const WORKER_ACTIVATE_TIMEOUT_MS = 10_000;

export async function getPushSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration();
	return registration?.pushManager.getSubscription() ?? null;
}

function waitUntilActive(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
	if (registration.active) return Promise.resolve(registration);

	return new Promise((resolve, reject) => {
		const pending = registration.installing ?? registration.waiting;
		const timer = setTimeout(() => {
			reject(new Error('The notification service worker did not activate'));
		}, WORKER_ACTIVATE_TIMEOUT_MS);

		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(registration);
		};

		if (!pending) {
			const onFound = () => {
				const installing = registration.installing;
				if (!installing) return;
				installing.addEventListener('statechange', () => {
					if (registration.active) finish();
				});
			};
			registration.addEventListener('updatefound', onFound, { once: true });
			return;
		}

		const onState = () => {
			if (pending.state === 'activated' || registration.active) {
				pending.removeEventListener('statechange', onState);
				finish();
				return;
			}
			if (pending.state === 'redundant') {
				pending.removeEventListener('statechange', onState);
				finish(new Error('The notification service worker was replaced before it activated'));
			}
		};
		pending.addEventListener('statechange', onState);
		onState();
	});
}

async function ensurePushRegistration(): Promise<ServiceWorkerRegistration> {
	const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
	if (registration.active) return registration;
	return waitUntilActive(registration);
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
	const registration = await ensurePushRegistration();
	const existing = await registration.pushManager.getSubscription();
	if (existing && subscriptionUsesPublicKey(existing, publicKey)) return existing;
	if (existing) {
		// A subscription is tied to the VAPID public key used to create it. Remove a
		// stale one so key rotation can recover through the normal Enable action.
		await deletePushSubscription(existing).catch(() => undefined);
		const removed = await existing.unsubscribe();
		if (!removed) throw new Error('The browser could not replace its old push subscription');
	}

	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: base64UrlToApplicationServerKey(publicKey)
	});
}

async function readError(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
}

export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
	const response = await fetch('/api/push/subscriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription.toJSON())
	});
	if (!response.ok) throw new Error(await readError(response));
}

export async function deletePushSubscription(subscription: PushSubscription): Promise<void> {
	const response = await fetch('/api/push/subscriptions', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: subscription.endpoint })
	});
	if (!response.ok) throw new Error(await readError(response));
}

export async function isPushSubscriptionRegistered(
	subscription: PushSubscription
): Promise<boolean> {
	const endpoint = encodeURIComponent(subscription.endpoint);
	const response = await fetch(`/api/push/subscriptions?endpoint=${endpoint}`);
	if (!response.ok) throw new Error(await readError(response));
	const body = (await response.json()) as { registered?: unknown };
	return body.registered === true;
}

/** Remove the current browser from the authenticated account before logout. */
export async function disablePushForCurrentAccount(): Promise<void> {
	if (!supportsWebPush()) return;
	const subscription = await getPushSubscription();
	if (!subscription) return;

	let serverError: unknown;
	try {
		await deletePushSubscription(subscription);
	} catch (error) {
		serverError = error;
	}

	const removed = await subscription.unsubscribe();
	if (!removed && !serverError) {
		throw new Error('The browser could not remove its push subscription');
	}
	if (serverError) throw serverError;
}

/**
 * After login, retain a native subscription only when the new account owns it.
 * This prevents a shared browser from continuing to receive another user's mail.
 */
export async function discardPushSubscriptionFromAnotherAccount(): Promise<void> {
	if (!supportsWebPush()) return;
	const subscription = await getPushSubscription();
	if (!subscription || (await isPushSubscriptionRegistered(subscription))) return;
	await subscription.unsubscribe();
}
