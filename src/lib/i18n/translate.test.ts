import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localeFromAcceptLanguage, localeShortLabel, matchLocale, parseLocale } from './locales';
import { translate } from './translate';

test('matches zh variants to Simplified Chinese', () => {
	assert.equal(matchLocale('zh'), 'zh-CN');
	assert.equal(matchLocale('zh-Hans'), 'zh-CN');
	assert.equal(matchLocale('zh_CN'), 'zh-CN');
	assert.equal(parseLocale('nope'), 'en');
});

test('short labels stay two-letter codes', () => {
	assert.equal(localeShortLabel('en'), 'EN');
	assert.equal(localeShortLabel('fr'), 'FR');
	assert.equal(localeShortLabel('zh-CN'), 'ZH');
	assert.equal(localeShortLabel('es'), 'ES');
});

test('reads Accept-Language quality values', () => {
	assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
	assert.equal(localeFromAcceptLanguage('es-MX,es;q=0.9'), 'es');
	assert.equal(localeFromAcceptLanguage(null), 'en');
});

test('interpolates params and returns unknown keys as-is', () => {
	assert.equal(translate('en', 'nav.inbox'), 'Inbox');
	assert.equal(translate('en', 'common.savedAt', { time: '3:01 PM' }), 'Saved 3:01 PM');
	assert.equal(translate('en', 'not.a.real.key'), 'not.a.real.key');
});

test('loads translated catalogs for starter locales', () => {
	assert.equal(translate('fr', 'nav.inbox'), 'Boîte de réception');
	assert.equal(translate('zh-CN', 'nav.inbox'), '收件箱');
	assert.equal(translate('es', 'nav.inbox'), 'Bandeja de entrada');
	assert.equal(translate('fr', 'common.savedAt', { time: '15:01' }), 'Enregistré 15:01');
});

function flattenKeys(tree: Record<string, unknown>, prefix = ''): string[] {
	const keys: string[] = [];
	for (const [name, value] of Object.entries(tree)) {
		const key = prefix ? `${prefix}.${name}` : name;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			keys.push(...flattenKeys(value as Record<string, unknown>, key));
		} else {
			keys.push(key);
		}
	}
	return keys;
}

test('locale catalogs expose the same keys as English', async () => {
	const en = (await import('../../../messages/en.json')).default as Record<string, unknown>;
	const expected = flattenKeys(en).sort();
	for (const locale of ['fr', 'zh-CN', 'es'] as const) {
		const catalog = (await import(`../../../messages/${locale}.json`)).default as Record<
			string,
			unknown
		>;
		assert.deepEqual(flattenKeys(catalog).sort(), expected, locale);
	}
});
