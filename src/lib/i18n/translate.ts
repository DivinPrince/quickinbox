import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import fr from '../../../messages/fr.json';
import zhCN from '../../../messages/zh-CN.json';
import { DEFAULT_LOCALE, parseLocale, type Locale } from './locales';

type MessageTree = Record<string, unknown>;

const catalogs: Record<Locale, MessageTree> = {
	en: en as MessageTree,
	fr: fr as MessageTree,
	'zh-CN': zhCN as MessageTree,
	es: es as MessageTree
};

export type TranslateParams = Record<string, string | number>;

function lookup(tree: MessageTree, key: string): string | undefined {
	let current: unknown = tree;
	for (const part of key.split('.')) {
		if (current === null || typeof current !== 'object' || !(part in current)) {
			return undefined;
		}
		current = (current as MessageTree)[part];
	}
	return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (_, name: string) =>
		params[name] == null ? `{${name}}` : String(params[name])
	);
}

export function translate(locale: string, key: string, params?: TranslateParams): string {
	const resolved = parseLocale(locale);
	const fromLocale = lookup(catalogs[resolved], key);
	const fromEnglish = resolved === DEFAULT_LOCALE ? undefined : lookup(catalogs.en, key);
	const template = fromLocale ?? fromEnglish ?? key;
	return interpolate(template, params);
}

export function plural(
	locale: string,
	oneKey: string,
	otherKey: string,
	count: number,
	params?: TranslateParams
): string {
	const key = count === 1 ? oneKey : otherKey;
	return translate(locale, key, { count, ...params });
}
