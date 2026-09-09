import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	authorizationServerMetadata,
	bearerChallenge,
	isAllowedRedirectUri,
	isClientMetadataUrl,
	isValidCodeChallenge,
	normalizeScope,
	OAuthError,
	parseClientMetadata,
	protectedResourceMetadata,
	redirectUriMatches,
	registrationResponse,
	verifyPkce
} from './oauth';
import { clientBrand, clientInitials, redirectHost } from '../oauth-brand';
import { loginHref, safeNextPath } from '../next-url';

describe('redirect URIs', () => {
	test('accepts https, loopback http and private-use schemes', () => {
		assert.equal(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
		assert.equal(isAllowedRedirectUri('http://localhost:3334/oauth/callback'), true);
		assert.equal(isAllowedRedirectUri('http://127.0.0.1/cb'), true);
		assert.equal(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback'), true);
		assert.equal(isAllowedRedirectUri('com.example.app:/oauth'), true);
	});

	test('rejects plain http, credentials and dangerous schemes', () => {
		assert.equal(isAllowedRedirectUri('http://example.com/cb'), false);
		assert.equal(isAllowedRedirectUri('https://user:pw@example.com/cb'), false);
		assert.equal(isAllowedRedirectUri('javascript:alert(1)'), false);
		assert.equal(isAllowedRedirectUri('data:text/html,hi'), false);
		assert.equal(isAllowedRedirectUri('not a url'), false);
	});

	test('matches exactly, with a port carve-out for loopback only', () => {
		const registered = ['https://app.example/cb', 'http://localhost:1234/cb'];
		assert.equal(redirectUriMatches(registered, 'https://app.example/cb'), true);
		assert.equal(redirectUriMatches(registered, 'https://app.example/cb2'), false);
		assert.equal(redirectUriMatches(registered, 'https://app.example:8443/cb'), false);
		assert.equal(redirectUriMatches(registered, 'http://localhost:9999/cb'), true);
		assert.equal(redirectUriMatches(registered, 'http://localhost:9999/other'), false);
		assert.equal(redirectUriMatches(registered, 'http://127.0.0.1:9999/cb'), false);
	});
});

describe('scopes', () => {
	test('empty means everything, unknown entries are dropped', () => {
		assert.deepEqual(normalizeScope(null), ['mail:read', 'mail:send']);
		assert.deepEqual(normalizeScope(''), ['mail:read', 'mail:send']);
		assert.deepEqual(normalizeScope('mail:send bogus'), ['mail:send']);
		assert.deepEqual(normalizeScope('  mail:read   mail:read'), ['mail:read']);
	});

	test('only unknown scopes is an invalid_scope error', () => {
		assert.throws(
			() => normalizeScope('admin'),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_scope'
		);
	});
});

describe('PKCE', () => {
	test('S256 verifier matches its challenge', async () => {
		// RFC 7636 appendix B vector.
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
		assert.equal(isValidCodeChallenge(challenge), true);
		assert.equal(await verifyPkce(verifier, challenge), true);
		assert.equal(await verifyPkce(`${verifier}x`, challenge), false);
	});

	test('challenge must be base64url of 43–128 chars', () => {
		assert.equal(isValidCodeChallenge('short'), false);
		assert.equal(isValidCodeChallenge('a'.repeat(43)), true);
		assert.equal(isValidCodeChallenge('a'.repeat(129)), false);
		assert.equal(isValidCodeChallenge(`${'a'.repeat(42)}+`), false);
	});
});

describe('client metadata', () => {
	test('normalises a typical dynamic registration', () => {
		const meta = parseClientMetadata({
			client_name: 'Claude',
			client_uri: 'https://claude.ai',
			logo_uri: 'http://insecure.example/logo.png',
			redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback'],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		});
		assert.equal(meta.client_name, 'Claude');
		assert.equal(meta.client_uri, 'https://claude.ai/');
		assert.equal(meta.logo_uri, null, 'non-https logos are dropped');
		assert.deepEqual(meta.redirect_uris, ['https://claude.ai/api/mcp/auth_callback']);
	});

	test('falls back to the redirect host when no name is given', () => {
		const meta = parseClientMetadata({ redirect_uris: ['http://localhost:6274/oauth/callback'] });
		assert.equal(meta.client_name, 'localhost');
	});

	test('refuses confidential clients and bad redirects', () => {
		assert.throws(
			() => parseClientMetadata({ redirect_uris: ['https://x.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_client_metadata'
		);
		assert.throws(
			() => parseClientMetadata({ redirect_uris: ['javascript:alert(1)'] }),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_redirect_uri'
		);
		assert.throws(
			() => parseClientMetadata({ redirect_uris: [] }),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_redirect_uri'
		);
		assert.throws(() => parseClientMetadata('nope'), OAuthError);
	});

	test('strips control characters from names and caps their length', () => {
		const meta = parseClientMetadata({
			client_name: `Evil\u0000\u001f${'x'.repeat(300)}`,
			redirect_uris: ['https://x.example/cb']
		});
		assert.equal(meta.client_name.includes('\u0000'), false);
		assert.equal(meta.client_name.length, 100);
	});

	test('registration response is a public client', () => {
		const response = registrationResponse({
			client_id: 'qi_client_abc',
			client_name: 'Cursor',
			client_uri: null,
			logo_uri: null,
			redirect_uris: ['http://localhost:1/cb'],
			created_at: '2026-09-09T12:00:00.000Z'
		});
		assert.equal(response.token_endpoint_auth_method, 'none');
		assert.equal(response.client_id_issued_at, Math.floor(Date.parse('2026-09-09T12:00:00.000Z') / 1000));
		assert.deepEqual(response.grant_types, ['authorization_code', 'refresh_token']);
	});

	test('metadata-document client ids are https URLs with a path', () => {
		assert.equal(isClientMetadataUrl('https://claude.ai/.well-known/oauth-client'), true);
		assert.equal(isClientMetadataUrl('https://claude.ai'), false);
		assert.equal(isClientMetadataUrl('http://claude.ai/x'), false);
		assert.equal(isClientMetadataUrl('qi_client_abc'), false);
	});
});

describe('discovery', () => {
	test('metadata points at this origin', () => {
		const origin = 'https://mail.alter.rw';
		const as = authorizationServerMetadata(origin);
		assert.equal(as.issuer, origin);
		assert.equal(as.authorization_endpoint, `${origin}/oauth/authorize`);
		assert.equal(as.token_endpoint, `${origin}/oauth/token`);
		assert.equal(as.registration_endpoint, `${origin}/oauth/register`);
		assert.equal(as.revocation_endpoint, `${origin}/oauth/revoke`);
		assert.deepEqual(as.code_challenge_methods_supported, ['S256']);

		const prm = protectedResourceMetadata(origin);
		assert.equal(prm.resource, `${origin}/mcp`);
		assert.deepEqual(prm.authorization_servers, [origin]);
	});

	test('bearer challenge carries resource_metadata and escapes quotes', () => {
		const challenge = bearerChallenge('https://m.example', { error: 'invalid_token', description: 'say "hi"' });
		assert.match(challenge, /^Bearer error="invalid_token", error_description="say 'hi'", resource_metadata="https:\/\/m\.example\/\.well-known\/oauth-protected-resource\/mcp", scope="mail:read mail:send"$/);
	});
});

describe('consent page helpers', () => {
	test('recognises well-known clients by name, uri or id', () => {
		assert.equal(clientBrand({ client_name: 'Claude' })?.icon, 'claude-fill');
		assert.equal(clientBrand({ client_name: 'claude-code', client_uri: null })?.label, 'Claude');
		assert.equal(clientBrand({ client_name: 'My tool', client_uri: 'https://cursor.com' })?.icon, 'cursor-ai-fill');
		assert.equal(clientBrand({ client_name: 'ChatGPT' })?.icon, 'openai-fill');
		assert.equal(clientBrand({ client_name: 'MCP Inspector' })?.icon, 'terminal-box-line');
		assert.equal(clientBrand({ client_name: 'Totally Unknown' }), null);
	});

	test('initials and redirect hosts', () => {
		assert.equal(clientInitials('Totally Unknown'), 'TU');
		assert.equal(clientInitials('zed'), 'ZE');
		assert.equal(clientInitials(''), '?');
		assert.equal(redirectHost('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
		assert.equal(redirectHost('http://localhost:3334/cb'), 'localhost:3334');
		assert.equal(redirectHost('cursor://anysphere.cursor-retrieval/oauth/callback'), 'cursor');
	});
});

describe('login ?next=', () => {
	test('only the consent page may be resumed', () => {
		assert.equal(safeNextPath('/oauth/authorize?client_id=x'), '/oauth/authorize?client_id=x');
		assert.equal(safeNextPath('/inbox'), null);
		assert.equal(safeNextPath('//evil.example/oauth/authorize?x'), null);
		assert.equal(safeNextPath('https://evil.example/oauth/authorize?x'), null);
		assert.equal(safeNextPath('/oauth/authorize?a=1\nSet-Cookie: x'), null);
		assert.equal(safeNextPath(null), null);
	});

	test('login href round-trips the path', () => {
		const href = loginHref('/oauth/authorize?client_id=x&state=y', { add: true });
		const url = new URL(href, 'https://m.example');
		assert.equal(url.pathname, '/login');
		assert.equal(url.searchParams.get('add'), '1');
		assert.equal(url.searchParams.get('next'), '/oauth/authorize?client_id=x&state=y');
	});
});
