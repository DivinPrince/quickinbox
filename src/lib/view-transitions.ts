import { onNavigate } from '$app/navigation';
import { isMobileViewport, navDirection, skipNextViewTransition } from '$lib/app-chrome';

/** Slide stacked screens on phones; fade tab switches. No-ops where unsupported. */
export function setupMobileViewTransitions(): void {
	onNavigate((navigation) => {
		if (skipNextViewTransition()) return;
		if (!isMobileViewport()) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (typeof document.startViewTransition !== 'function') return;

		const fromPath = navigation.from?.url.pathname ?? '';
		const toPath = navigation.to?.url.pathname ?? '';
		document.documentElement.dataset.nav = navDirection(fromPath, toPath, navigation.type);

		return new Promise<void>((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
}
