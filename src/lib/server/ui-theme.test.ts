import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserUiTheme, setUserUiTheme } from './ui-theme';
import { BUILTIN_THEME_IDS, parseThemeId } from '../ui-theme/ids';

describe('mail interface preferences', () => {
	test('preserves each saved interface across account loads', async () => {
		for (const theme of ['classic', 'zero']) {
			const db = {
				prepare: () => ({ bind: () => ({ first: async () => ({ ui_theme: theme }) }) })
			} as unknown as D1Database;
			assert.equal(await getUserUiTheme(db, 'existing-user'), theme);
			assert.equal(parseThemeId(theme, BUILTIN_THEME_IDS), theme);
		}
	});

	test('saves both interfaces for the selected account', async () => {
		const writes: unknown[][] = [];
		const db = {
			prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { writes.push(values); } }) })
		} as unknown as D1Database;
		assert.equal(await setUserUiTheme(db, 'current-user', 'classic'), 'classic');
		assert.equal(await setUserUiTheme(db, 'current-user', 'zero'), 'zero');
		assert.deepEqual(writes, [['classic', 'current-user'], ['zero', 'current-user']]);
	});

	test('unknown interface writes are rejected without changing the account', async () => {
		const db = {
			prepare: () => { throw new Error('Database should not be changed'); }
		} as unknown as D1Database;
		for (const theme of ['', 'missing-theme', '../classic']) {
			await assert.rejects(setUserUiTheme(db, 'existing-user', theme), /Unknown theme/);
		}
	});

	test('missing and unknown saved preferences fall back to Zero', async () => {
		for (const theme of [null, '', 'missing-theme']) {
			const db = {
				prepare: () => ({ bind: () => ({ first: async () => ({ ui_theme: theme }) }) })
			} as unknown as D1Database;
			assert.equal(await getUserUiTheme(db, 'existing-user'), 'zero');
		}
	});

	test('first paint restores either interface and gives the account cookie precedence', () => {
		const html = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script);
		for (const [cookie, stored, expected] of [
			['', 'classic', 'classic'],
			['', 'zero', 'zero'],
			['qi_ui_theme=classic', 'zero', 'classic'],
			['qi_ui_theme=zero', 'classic', 'zero'],
			['', '', 'zero']
		]) {
			const attributes: Record<string, string> = {};
			const root = {
				dataset: {} as Record<string, string>,
				style: {},
				setAttribute: (key: string, value: string) => { attributes[key] = value; }
			};
			runInNewContext(script, {
				document: { cookie, documentElement: root, querySelectorAll: () => [] },
				localStorage: { getItem: (key: string) => key === 'quickinbox:ui-theme' ? stored : null },
				matchMedia: () => ({ matches: true })
			});
			assert.equal(root.dataset.uiTheme ?? attributes['data-ui-theme'], expected);
			assert.equal(root.dataset.theme, 'dark');
		}
	});
});
