export const UI_THEME_COOKIE = 'qi_ui_theme';
export const UI_THEME_STORAGE_KEY = 'quickinbox:ui-theme';
export const DEFAULT_UI_THEME = 'zero';
export const THEME_ENGINE = 'quickinbox-theme@1';

export const BUILTIN_THEME_IDS = ['zero', 'classic'] as const;

export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

export function isThemeId(value: string | null | undefined): value is string {
	return typeof value === 'string' && value.length > 0 && value.length < 64 && /^[a-z0-9-]+$/.test(value);
}

/** Unknown ids fall back to Zero so a stale cookie cannot blank the app. */
export function parseThemeId(value: string | null | undefined, known: readonly string[]): string {
	if (isThemeId(value) && known.includes(value)) return value;
	return DEFAULT_UI_THEME;
}
