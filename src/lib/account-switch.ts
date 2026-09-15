import { disablePushForCurrentAccount } from './push-client';

/** Where the login form sends people who want a second account in this browser. */
export const ADD_ACCOUNT_HREF = '/login?add=1';

async function readNext(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as { next?: unknown } | null;
	return typeof body?.next === 'string' ? body.next : fallback;
}

/**
 * Make another signed-in account active, then reload so every server-loaded
 * piece of state (mailbox, counts, theme, locale) belongs to it.
 */
export async function switchAccount(userId: string): Promise<void> {
	const response = await fetch('/api/auth/switch', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId })
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
		throw new Error(typeof body?.error === 'string' ? body.error : 'Could not switch account');
	}
	window.location.assign(await readNext(response, '/inbox'));
}

/**
 * Log out of the active account. If other accounts are signed in on this
 * browser the server promotes the next one and we land back in its inbox;
 * `everywhere` ends all of them.
 */
export async function logoutAccount(everywhere = false): Promise<void> {
	try {
		await disablePushForCurrentAccount();
	} catch (error) {
		console.warn('Could not fully remove the push subscription during logout', error);
	} finally {
		const response = await fetch(`/api/auth/login${everywhere ? '?all=1' : ''}`, { method: 'DELETE' });
		window.location.href = await readNext(response, '/login');
	}
}
