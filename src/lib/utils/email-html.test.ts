import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptDarkColours } from './email-html';

test('adapts named black and white colors for dark mode', () => {
	assert.equal(
		adaptDarkColours('<div style="color:black;background:white">Hello</div>'),
		'<div style="color:#f2f2f7;background:#1f1f23">Hello</div>'
	);
	assert.equal(
		adaptDarkColours('<table bgcolor="white"><td color="black">Hello</td></table>'),
		'<table bgcolor="#1f1f23"><td color="#f2f2f7">Hello</td></table>'
	);
});

test('normalizes percentage rgb channels and alpha', () => {
	assert.equal(
		adaptDarkColours('<p style="color:rgb(0% 0% 0% / 100%)">Hello</p>'),
		'<p style="color:#f2f2f7">Hello</p>'
	);
	assert.equal(
		adaptDarkColours('<p style="color:rgb(0 0 0 / 10%)">Hello</p>'),
		'<p style="color:rgb(0 0 0 / 10%)">Hello</p>'
	);
	assert.equal(
		adaptDarkColours('<div style="background:rgb(100% 100% 100%)">Hello</div>'),
		'<div style="background:#1f1f23">Hello</div>'
	);
});

test('leaves unrelated attributes and text untouched', () => {
	assert.equal(
		adaptDarkColours(
			'<div data-color="black" title="color=black" color="black">color=black</div>'
		),
		'<div data-color="black" title="color=black" color="#f2f2f7">color=black</div>'
	);
});

test('does not scan unbounded unterminated rgb functions', () => {
	const malformed = `rgb(${'0 '.repeat(10_000)}`;
	assert.equal(
		adaptDarkColours(`<p style="color:${malformed}">Hello</p>`),
		`<p style="color:${malformed}">Hello</p>`
	);
});
