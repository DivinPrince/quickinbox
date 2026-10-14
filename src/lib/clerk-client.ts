/** Minimal surface of the Clerk browser SDK that the sign-in screen uses. */
export type ClerkBrowser = {
	load(): Promise<void>;
	user?: unknown;
	mountSignIn(
		node: HTMLElement,
		props: { forceRedirectUrl?: string; appearance?: Record<string, unknown> }
	): void;
	mountSignUp(
		node: HTMLElement,
		props: { forceRedirectUrl?: string; signInUrl?: string; appearance?: Record<string, unknown> }
	): void;
	signOut(options?: { redirectUrl?: string }): Promise<void>;
	openUserProfile(props?: { appearance?: Record<string, unknown> }): void;
	openSignIn(props?: { forceRedirectUrl?: string; appearance?: Record<string, unknown> }): void;
};

/**
 * A publishable key is `pk_(test|live)_` + base64 of `<frontend-api-host>$`.
 * Returns null for anything that doesn't decode to a plausible host.
 */
export function frontendApiHost(publishableKey: string): string | null {
	const encoded = publishableKey.split('_')[2];
	if (!encoded) return null;
	try {
		const host = atob(encoded).replace(/\$$/, '');
		return /^[a-z0-9.-]+$/i.test(host) ? host : null;
	} catch {
		return null;
	}
}

/** Load clerk-js from the instance's own frontend API host, once. */
export async function loadClerk(publishableKey: string): Promise<ClerkBrowser> {
	const host = frontendApiHost(publishableKey);
	if (!host) throw new Error('Invalid Clerk publishable key');

	const existing = (window as unknown as { Clerk?: ClerkBrowser }).Clerk;
	if (!existing) {
		await new Promise<void>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
			script.async = true;
			script.crossOrigin = 'anonymous';
			script.setAttribute('data-clerk-publishable-key', publishableKey);
			script.onload = () => resolve();
			script.onerror = () => reject(new Error('Could not load Clerk'));
			document.head.append(script);
		});
	}

	const clerk = (window as unknown as { Clerk?: ClerkBrowser }).Clerk;
	if (!clerk) throw new Error('Clerk did not initialise');
	await clerk.load();
	return clerk;
}

/**
 * Clerk's look, taken from the app's theme so it isn't a white card on a dark
 * page. `embedded` also flattens Clerk's own card and drops its header and
 * "Sign up" link, for use inside our sign-in card; the profile modal keeps its
 * own chrome and only takes the colors.
 */
export function clerkAppearance(embedded: boolean): Record<string, unknown> {
	const css = getComputedStyle(document.documentElement);
	const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
	const variables = {
		colorText: token('--color-text', '#111111'),
		colorTextSecondary: token('--color-text-secondary', '#666666'),
		colorBackground: token('--color-surface', '#ffffff'),
		colorInputBackground: token('--color-surface-muted', '#f3f3f3'),
		colorInputText: token('--color-text', '#111111'),
		colorPrimary: token('--color-accent', '#90ac9a'),
		colorTextOnPrimaryBackground: '#111111',
		borderRadius: '0.5rem'
	};
	if (!embedded) return { variables };

	const flat = { boxShadow: 'none', background: 'transparent', border: 'none' };
	return {
		variables,
		elements: {
			rootBox: { width: '100%' },
			// Clerk's card sits at margin-left:-1px inside a cardBox that clips its
			// overflow, normally masked by the card's own padding. With that padding
			// gone the left edge of every field was cut off, so neutralise both.
			cardBox: { ...flat, width: '100%', overflow: 'visible' },
			card: { ...flat, padding: 0, margin: 0, width: '100%' },
			// The page already shows the logo and "Sign in".
			header: { display: 'none' },
			// Access is decided by the server, not by whether Clerk offers sign-up.
			footerAction: { display: 'none' },
			footer: flat,
			socialButtonsBlockButton: {
				background: token('--color-surface-muted', '#f3f3f3')
			},
			socialButtonsBlockButtonText: { color: token('--color-text', '#111111') },
			dividerLine: { background: 'rgba(128, 128, 128, 0.3)' },
			dividerText: { color: token('--color-text-secondary', '#666666') }
		}
	};
}

/** The publishable key when this install signs in through Clerk, else null. */
export function manageAccountKey(pageData: Record<string, unknown>): string | null {
	return pageData.authMode === 'clerk' && typeof pageData.clerkPublishableKey === 'string'
		? pageData.clerkPublishableKey
		: null;
}

/**
 * Open Clerk's account modal: name, emails, password, sessions. Changes reach
 * the app through the `user.updated` webhook. Someone whose browser has no
 * Clerk session (signed in before Clerk was on) is asked to sign in first.
 */
export async function openManageAccount(publishableKey: string): Promise<void> {
	try {
		const clerk = await loadClerk(publishableKey);
		if (clerk.user) clerk.openUserProfile({ appearance: clerkAppearance(false) });
		else clerk.openSignIn({ forceRedirectUrl: window.location.href, appearance: clerkAppearance(false) });
	} catch (error) {
		console.warn('Could not open the Clerk account modal', error);
	}
}

