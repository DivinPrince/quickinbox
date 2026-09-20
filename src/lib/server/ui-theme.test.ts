import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserUiTheme, setUserUiTheme } from './ui-theme';
import { BUILTIN_THEME_IDS, parseThemeId } from '../ui-theme/ids';

describe('unified mail interface', () => {
	test('stored Classic accounts and cookies resolve to Zero', async () => {
		const db = {
			prepare: () => ({ bind: () => ({ first: async () => ({ ui_theme: 'classic' }) }) })
		} as unknown as D1Database;
		assert.equal(await getUserUiTheme(db, 'existing-user'), 'zero');
		assert.equal(parseThemeId('classic', BUILTIN_THEME_IDS), 'zero');
	});

	test('retired interface writes are rejected without changing the account', async () => {
		const db = {
			prepare: () => { throw new Error('Database should not be changed'); }
		} as unknown as D1Database;
		await assert.rejects(setUserUiTheme(db, 'existing-user', 'classic'), /Unknown theme/);
	});

	test('first paint uses Zero for old Classic browser preferences', () => {
		const html = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script);
		for (const cookie of ['', 'qi_ui_theme=classic']) {
			const attributes: Record<string, string> = {};
			const root = {
				dataset: {} as Record<string, string>,
				style: {},
				setAttribute: (key: string, value: string) => { attributes[key] = value; }
			};
			runInNewContext(script, {
				document: { cookie, documentElement: root, querySelectorAll: () => [] },
				localStorage: { getItem: (key: string) => key === 'quickinbox:ui-theme' ? 'classic' : null },
				matchMedia: () => ({ matches: true })
			});
			assert.equal(root.dataset.uiTheme ?? attributes['data-ui-theme'], 'zero');
			assert.equal(root.dataset.theme, 'dark');
		}
	});
});
