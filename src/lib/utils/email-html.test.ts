import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptDarkColours, buildEmailDocument } from './email-html';

test('remote resources are blocked before any sender markup, including malformed full documents', () => {
  const html = '<img src="https://tracking.test/pixel"><html><head></head><body><img srcset="https://tracking.test/other 2x"><div style="background:url(https://tracking.test/bg)">Hi</div></body></html>';
  const document = buildEmailDocument(html, { rich: true, messageId: 'mail-1', origin: 'https://mail.example.test' });
  assert.ok(document.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  const policy = document.match(/content="([^"]+)"/)![1];
  assert.match(policy, /img-src data: https:\/\/mail.example.test\/api\/mail\/mail-1\/attachments\//);
  assert.doesNotMatch(policy, /img-src[^;]* https:(?:;| )/);
  assert.doesNotMatch(policy, /img-src[^;]* http:/);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /style-src 'unsafe-inline'/);
});

test('remote images load only when explicitly allowed; untrusted ids cannot expand the policy', () => {
  const allowed = buildEmailDocument('<img src="https://example.test/a">', { rich: true, allowRemoteImages: true });
  assert.match(allowed, /img-src data: https: http:;/);
  const blocked = buildEmailDocument('<p>Hello</p>', { rich: false, messageId: 'bad; https:', origin: 'https://mail.example.test' });
  assert.match(blocked, /img-src data:;/);
});

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
