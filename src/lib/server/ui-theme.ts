import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_UI_THEME, isThemeId } from '$lib/ui-theme/ids';

export async function getUserUiTheme(db: D1Database, userId: string): Promise<string> {
	const row = await db
		.prepare('SELECT ui_theme FROM users WHERE id = ?')
		.bind(userId)
		.first<{ ui_theme: string | null }>();
	return isThemeId(row?.ui_theme) ? row.ui_theme : DEFAULT_UI_THEME;
}

export async function setUserUiTheme(
	db: D1Database,
	userId: string,
	theme: string
): Promise<string> {
	if (!isThemeId(theme)) {
		throw new Error('Unknown theme');
	}
	await db.prepare('UPDATE users SET ui_theme = ? WHERE id = ?').bind(theme, userId).run();
	return theme;
}
