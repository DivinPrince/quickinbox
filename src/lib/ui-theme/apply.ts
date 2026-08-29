import { UI_THEME_COOKIE, UI_THEME_STORAGE_KEY } from './ids';

export function persistUiTheme(id: string): void {
	document.documentElement.dataset.uiTheme = id;
	localStorage.setItem(UI_THEME_STORAGE_KEY, id);
	const maxAge = 60 * 60 * 24 * 365;
	document.cookie = `${UI_THEME_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export async function switchUiTheme(id: string): Promise<void> {
	persistUiTheme(id);
	await fetch('/api/settings/ui-theme', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ theme: id })
	});
	window.location.reload();
}
