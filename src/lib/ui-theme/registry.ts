import { theme as classic } from '$themes/classic/index';
import { theme as zero } from '$themes/zero/index';
import { DEFAULT_UI_THEME, parseThemeId } from './ids';
import type { ThemeModule } from './types';

const builtins: ThemeModule[] = [zero, classic];

const discovered = import.meta.glob('../../themes/*/index.ts', { eager: true }) as Record<
	string,
	{ theme?: ThemeModule }
>;

function extraThemes(): ThemeModule[] {
	const extras: ThemeModule[] = [];
	for (const [path, mod] of Object.entries(discovered)) {
		const candidate = mod.theme;
		if (!candidate?.id || builtins.some((theme) => theme.id === candidate.id)) continue;
		if (path.includes('/classic/') || path.includes('/zero/')) continue;
		extras.push(candidate);
	}
	return extras;
}

export const themes: ThemeModule[] = [...builtins, ...extraThemes()];

export function listThemeIds(): string[] {
	return themes.map((theme) => theme.id);
}

export function listThemes(): { id: string; name: string }[] {
	return themes.map((theme) => ({ id: theme.id, name: theme.name }));
}

export function getTheme(id: string | null | undefined): ThemeModule {
	const resolved = parseThemeId(id, listThemeIds());
	return themes.find((theme) => theme.id === resolved) ?? zero;
}
