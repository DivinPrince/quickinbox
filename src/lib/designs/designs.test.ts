import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { DEFAULT_DESIGN_ID, DESIGNS, getDesign, isDesignId } from './catalog';
import { DESIGN_STORAGE_KEY, readDesignId } from './apply';
import type { DesignDefinition, DesignMark, MailboxLayout } from './types';

const MARKS = new Set<DesignMark>(['mail', 'zero']);
const LAYOUTS = new Set<MailboxLayout>(['row', 'stack']);

function assertDesign(design: DesignDefinition) {
	assert.ok(design.id.trim(), 'design id is required');
	assert.ok(design.label.trim(), `${design.id} needs a label`);
	assert.ok(design.description.trim(), `${design.id} needs a description`);
	assert.ok(design.brandName.trim(), `${design.id} needs a brandName`);
	assert.ok(design.composeLabel.trim(), `${design.id} needs a composeLabel`);
	assert.ok(MARKS.has(design.mark), `${design.id} has unknown mark ${design.mark}`);
	assert.ok(LAYOUTS.has(design.mailboxLayout), `${design.id} has unknown mailbox layout`);
	assert.ok(Array.isArray(design.fonts), `${design.id} fonts must be an array`);
	for (const font of design.fonts) {
		assert.ok(font.href.startsWith('https://'), `${design.id} font href must be absolute`);
		assert.ok(font.family.trim(), `${design.id} font family is required`);
	}

	for (const key of ['background', 'surface', 'sidebar', 'accent', 'text', 'muted'] as const) {
		assert.match(
			design.preview[key],
			/^(#|hsl\(|rgb\(|oklch\()/i,
			`${design.id} preview.${key} must be a color`
		);
	}
}

describe('design catalog', () => {
	test('ships Mail and 0.email, with Mail as the default', () => {
		assert.equal(DEFAULT_DESIGN_ID, 'mail');
		assert.ok(DESIGNS.some((design) => design.id === 'mail'));
		assert.ok(DESIGNS.some((design) => design.id === 'zero'));
		assert.equal(getDesign('zero').label, '0.email');
	});

	test('every registered design is complete and uniquely identified', () => {
		const ids = DESIGNS.map((design) => design.id);
		assert.equal(ids.length, new Set(ids).size);
		for (const design of DESIGNS) assertDesign(design);
	});

	test('unknown ids fall back to Mail so a stale localStorage value cannot crash the shell', () => {
		assert.equal(isDesignId('zero'), true);
		assert.equal(isDesignId('mail'), true);
		assert.equal(isDesignId('does-not-exist'), false);
		assert.equal(isDesignId(null), false);
		assert.equal(getDesign('does-not-exist').id, DEFAULT_DESIGN_ID);
		assert.equal(getDesign(undefined).id, DEFAULT_DESIGN_ID);
	});

	test('non-default designs ship a CSS file scoped to their data-design attribute', () => {
		for (const design of DESIGNS) {
			if (design.id === DEFAULT_DESIGN_ID) continue;
			const cssPath = fileURLToPath(
				new URL(`../../styles/designs/${design.id}.css`, import.meta.url)
			);
			assert.ok(existsSync(cssPath), `missing src/styles/designs/${design.id}.css`);
			const css = readFileSync(cssPath, 'utf8');
			assert.ok(
				css.includes(`[data-design='${design.id}']`),
				`${design.id}.css must scope rules to [data-design='${design.id}']`
			);
		}
	});

	test('0.email CSS uses Zero’s compose blue and Geist', () => {
		const cssPath = fileURLToPath(new URL('../../styles/designs/zero.css', import.meta.url));
		const css = readFileSync(cssPath, 'utf8');
		assert.ok(css.includes('#006ffe'));
		assert.ok(css.includes('Geist Variable'));
		assert.ok(css.includes('--sidebar-width: 14rem'));
	});

	test('persists the choice under a stable key', () => {
		assert.equal(DESIGN_STORAGE_KEY, 'mail:design');
		if (typeof localStorage === 'undefined') return;
		localStorage.removeItem(DESIGN_STORAGE_KEY);
		assert.equal(readDesignId(), DEFAULT_DESIGN_ID);
		localStorage.setItem(DESIGN_STORAGE_KEY, 'zero');
		assert.equal(readDesignId(), 'zero');
		localStorage.setItem(DESIGN_STORAGE_KEY, 'not-a-design');
		assert.equal(readDesignId(), DEFAULT_DESIGN_ID);
		localStorage.removeItem(DESIGN_STORAGE_KEY);
	});
});
