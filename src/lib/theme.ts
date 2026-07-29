export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'mail:theme';

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
	{ value: 'light', label: 'Light', icon: 'sun-line' },
	{ value: 'dark', label: 'Dark', icon: 'moon-line' },
	{ value: 'system', label: 'System', icon: 'computer-line' }
];

function isPreference(value: string | null): value is ThemePreference {
	return value === 'light' || value === 'dark' || value === 'system';
}

export function readThemePreference(): ThemePreference {
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	return isPreference(stored) ? stored : 'system';
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
	if (preference !== 'system') return preference;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Stamps the resolved theme on <html>. The same thing happens in the inline
 * script in app.html so the first paint is already correct.
 */
export function applyTheme(preference: ThemePreference): void {
	document.documentElement.dataset.theme = resolveTheme(preference);
}

export function setThemePreference(preference: ThemePreference): void {
	localStorage.setItem(THEME_STORAGE_KEY, preference);
	applyTheme(preference);
}

/** Follows the OS while the preference is "system". Returns an unsubscriber. */
export function watchSystemTheme(): () => void {
	const query = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = () => {
		if (readThemePreference() === 'system') applyTheme('system');
	};

	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}
