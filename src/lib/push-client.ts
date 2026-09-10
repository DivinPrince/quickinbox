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
	// Safari's plain subscription objects carry no options; the server-side
	// registration check then decides whether the subscription still belongs
	// to this account.
	if (!subscription.options?.applicationServerKey) return true;
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

let activePushRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register and activate the push worker at page load. Safari only shows its
 * permission prompt while the click's gesture is still alive, so everything
 * must be ready before the user reaches for the Enable button.
 */
export function prewarmPushRegistration(): Promise<void> {
	if (!supportsWebPush()) return Promise.resolve();
	return ensurePushRegistration()
		.then((registration) => {
			activePushRegistration = registration;
		})
		.catch(() => undefined);
}

/**
 * Start subscribing without any awaits first. Apple requires the push
 * subscription call to happen immediately from the click's event handler;
 * even fast awaits before it make Safari refuse with a silent NotAllowedError.
 * Returns null when the worker is not active yet, so callers can fall back to
 * the async path on browsers that keep the gesture alive across awaits.
 */
export function subscribeToPushImmediately(publicKey: string): Promise<PushSubscription> | null {
	const registration = activePushRegistration;
	if (!registration) return null;
	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: base64UrlToApplicationServerKey(publicKey)
	});
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
	const registration = await ensurePushRegistration();
	const existing = await registration.pushManager.getSubscription();
	if (existing && subscriptionUsesPublicKey(existing, publicKey)) return existing;
	if (existing) {
		// A subscription is tied to the VAPID public key used to create it. Remove a
		// stale one so key rotation can recover through the normal Enable action.
		await deletePushSubscription(existing).catch(() => undefined);
		const removed = await unsubscribeSubscription(existing);
		if (!removed) throw new Error('The browser could not replace its old push subscription');
	}

	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: base64UrlToApplicationServerKey(publicKey)
	});
}

/** Stop this browser's subscription. Safari's plain subscription objects have
 * no unsubscribe(); removing the server-side record is then the only cleanup. */
export async function unsubscribeSubscription(
	subscription: PushSubscription
): Promise<boolean> {
	if (typeof subscription.unsubscribe !== 'function') return true;
	return subscription.unsubscribe();
}

async function readError(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function keyAsBase64Url(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value instanceof ArrayBuffer) return base64UrlEncode(value);
	if (value instanceof Uint8Array) {
		return base64UrlEncode(
			value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
		);
	}
	return null;
}

/** Safari's subscribe() resolves with a plain JSON-shaped object that lacks
 * toJSON() and getKey(), so fall back to reading its keys attribute. */
export function pushSubscriptionPayload(subscription: PushSubscription): string {
	const plain = subscription as unknown as {
		keys?: unknown;
		p256dh?: unknown;
		auth?: unknown;
	};
	const endpoint = subscription.endpoint;
	const expirationTime = subscription.expirationTime ?? null;

	if (typeof subscription.toJSON === 'function') return JSON.stringify(subscription.toJSON());

	let p256dh: string | null = null;
	let auth: string | null = null;
	if (typeof subscription.getKey === 'function') {
		p256dh = keyAsBase64Url(subscription.getKey('p256dh'));
		auth = keyAsBase64Url(subscription.getKey('auth'));
	}
	if (!p256dh || !auth) {
		const rawKeys = plain.keys as Record<string, unknown> | null | undefined;
		if (rawKeys) {
			p256dh = keyAsBase64Url(rawKeys.p256dh);
			auth = keyAsBase64Url(rawKeys.auth);
		}
	}
	if (!p256dh || !auth) {
		p256dh = keyAsBase64Url(plain.p256dh);
		auth = keyAsBase64Url(plain.auth);
	}
	if (!p256dh || !auth) {
		console.warn(
			'Unrecognized push subscription shape',
			JSON.stringify({
				proto: Object.getPrototypeOf(subscription)?.constructor?.name ?? typeof subscription,
				props: Object.getOwnPropertyNames(subscription),
				value: (() => {
					try {
						return JSON.stringify(subscription);
					} catch (error) {
						return `unserializable: ${String(error)}`;
					}
				})()
			})
		);
		throw new Error('The browser returned an unreadable push subscription');
	}

	return JSON.stringify({ endpoint, expirationTime, keys: { p256dh, auth } });
}

export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
	const response = await fetch('/api/push/subscriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: pushSubscriptionPayload(subscription)
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

	const removed = await unsubscribeSubscription(subscription);
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
	await unsubscribeSubscription(subscription);
}
