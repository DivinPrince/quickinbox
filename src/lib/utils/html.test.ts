import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHtmlEmpty } from './html';

test('treats image tags as content', () => {
	assert.equal(isHtmlEmpty('<p><img src="x" alt=""></p>'), false);
});

test('SSR emptiness decodes numeric and hex whitespace entities', () => {
	const original = globalThis.DOMParser;
	const hadParser = typeof original === 'function';
	// @ts-expect-error -- drop the parser to exercise the SSR branch
	delete globalThis.DOMParser;
	try {
		assert.equal(typeof DOMParser, 'undefined');
		assert.equal(isHtmlEmpty(''), true);
		assert.equal(isHtmlEmpty('<p></p>'), true);
		assert.equal(isHtmlEmpty('<p>&nbsp;</p>'), true);
		assert.equal(isHtmlEmpty('<p>&#160;</p>'), true);
		assert.equal(isHtmlEmpty('<p>&#xA0;</p>'), true);
		assert.equal(isHtmlEmpty('<p>hello</p>'), false);
		assert.equal(isHtmlEmpty('<p><img src="x"></p>'), false);
	} finally {
		if (hadParser) globalThis.DOMParser = original;
	}
});
