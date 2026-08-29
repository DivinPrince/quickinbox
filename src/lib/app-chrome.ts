export const SERVICE_WORKER_URL = '/service-worker.js';

export const MAILBOX_PATHS = ['/inbox', '/sent', '/starred', '/drafts', '/trash', '/archive'] as const;
export const PRIMARY_TABS = ['/inbox', '/starred', '/sent'] as const;

export type NavDirection = 'forward' | 'back' | 'tab';

export function isMailboxPath(pathname: string): boolean {
	return MAILBOX_PATHS.some((path) => pathname === path);
}

/** Thread and compose take over the phone — no search bar or tab bar. */
export function isStackedPath(pathname: string): boolean {
	return pathname === '/compose' || pathname.startsWith('/mail/');
}

export function isPrimaryTab(pathname: string): boolean {
	return PRIMARY_TABS.some((path) => pathname === path);
}

/** Settings and admin — keep the tab bar, hide the search topbar. */
export function isUtilityPath(pathname: string): boolean {
	return (
		pathname === '/settings' ||
		pathname === '/admin' ||
		pathname.startsWith('/settings/') ||
		pathname.startsWith('/admin/')
	);
}

export function isMorePath(pathname: string): boolean {
	return (
		pathname === '/drafts' ||
		pathname === '/trash' ||
		pathname === '/archive' ||
		pathname === '/settings' ||
		pathname === '/admin' ||
		pathname.startsWith('/settings/') ||
		pathname.startsWith('/admin/')
	);
}

export function isMobileViewport(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
}

export function isStandaloneDisplay(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		window.matchMedia('(display-mode: fullscreen)').matches ||
		('standalone' in navigator &&
			(navigator as Navigator & { standalone?: boolean }).standalone === true)
	);
}

export function isIOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

export function registerAppServiceWorker(): void {
	if (!('serviceWorker' in navigator)) return;
	// Vite serves the worker as an unbundled `import` in dev, which the browser rejects.
	if (import.meta.env.DEV) return;
	void navigator.serviceWorker.register(SERVICE_WORKER_URL).catch((error) => {
		console.warn('Could not register the app service worker', error);
	});
}

export function navDirection(fromPath: string, toPath: string, type: string): NavDirection {
	if (type === 'popstate') return 'back';
	const fromStacked = isStackedPath(fromPath);
	const toStacked = isStackedPath(toPath);
	if (!fromStacked && toStacked) return 'forward';
	if (fromStacked && !toStacked) return 'back';
	return 'tab';
}

let skipTransition = false;

/** Call after a gesture already moved the screen so the view transition does not replay it. */
export function requestSkipViewTransition(): void {
	skipTransition = true;
}

/** Consume the skip flag. Returns true when the next transition should be omitted. */
export function skipNextViewTransition(): boolean {
	if (!skipTransition) return false;
	skipTransition = false;
	return true;
}

export function haptic(ms = 10): void {
	try {
		navigator.vibrate?.(ms);
	} catch {
		// Vibration is optional and can throw if the page is not focused.
	}
}

/** In-app navigations only — `history.length` includes entries from before this tab loaded. */
let inAppDepth = 0;

export function noteInAppNavigation(type: string): void {
	if (type === 'popstate') {
		inAppDepth = Math.max(0, inAppDepth - 1);
		return;
	}
	if (type === 'link' || type === 'goto') {
		inAppDepth += 1;
	}
}

export function hasInAppHistory(): boolean {
	return inAppDepth > 0;
}

export type InstallPromptEvent = Event & { prompt: () => Promise<void> };

let installPrompt: InstallPromptEvent | null = null;
let capturingInstallPrompt = false;
const installPromptListeners = new Set<(prompt: InstallPromptEvent | null) => void>();

function notifyInstallPrompt(): void {
	for (const listener of installPromptListeners) listener(installPrompt);
}

/** Listen from the persistent shell so Settings can still install after Inbox already saw the event. */
export function captureInstallPrompt(): void {
	if (typeof window === 'undefined' || capturingInstallPrompt) return;
	capturingInstallPrompt = true;
	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		installPrompt = event as InstallPromptEvent;
		notifyInstallPrompt();
	});
	window.addEventListener('appinstalled', () => {
		installPrompt = null;
		notifyInstallPrompt();
	});
}

export function subscribeInstallPrompt(
	listener: (prompt: InstallPromptEvent | null) => void
): () => void {
	installPromptListeners.add(listener);
	listener(installPrompt);
	return () => {
		installPromptListeners.delete(listener);
	};
}

export function clearInstallPrompt(): void {
	installPrompt = null;
	notifyInstallPrompt();
}
