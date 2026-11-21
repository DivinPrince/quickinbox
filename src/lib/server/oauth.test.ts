import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isRedirect } from '@sveltejs/kit';
import {
	authorizationServerMetadata,
	bearerChallenge,
	getClient,
	getUserByOAuthToken,
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
import { createTestDb, insertTestUser } from './test-db';
import { GET as getAuthorizationServerMetadata } from '../../routes/.well-known/oauth-authorization-server/+server';
import { POST as postRegister } from '../../routes/oauth/register/+server';
import { actions as authorizeActions, load as loadAuthorize } from '../../routes/oauth/authorize/+page.server';
import { POST as postToken } from '../../routes/oauth/token/+server';

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

	test('metadata-document client ids are https URLs with a public path', () => {
		assert.equal(isClientMetadataUrl('https://claude.ai/.well-known/oauth-client'), true);
		assert.equal(isClientMetadataUrl('https://claude.ai'), false);
		assert.equal(isClientMetadataUrl('http://claude.ai/x'), false);
		assert.equal(isClientMetadataUrl('qi_client_abc'), false);
		assert.equal(isClientMetadataUrl('https://127.0.0.1/meta'), false);
		assert.equal(isClientMetadataUrl('https://10.0.0.8/meta'), false);
		assert.equal(isClientMetadataUrl('https://169.254.169.254/latest/meta-data'), false);
		assert.equal(isClientMetadataUrl('https://localhost/oauth-client.json'), false);
	});
});

describe('client metadata documents', () => {
	const clientId = 'https://client.example/oauth/client-metadata.json';
	const document = {
		client_id: clientId,
		client_name: 'Example MCP client',
		client_uri: 'https://client.example',
		redirect_uris: ['https://client.example/oauth/callback'],
		token_endpoint_auth_method: 'none'
	};

	/** Behaves like fetch on Workers, which throws on redirect: 'error' before sending anything. */
	function workersFetch(respond: () => Response): typeof fetch {
		return (async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.redirect === 'error') throw new TypeError('Invalid redirect value');
			return respond();
		}) as typeof fetch;
	}

	test('a URL client_id is fetched once, then served from D1', async () => {
		const { db } = createTestDb();
		const client = await getClient(db, clientId, workersFetch(() => Response.json(document)));
		assert.equal(client?.client_name, 'Example MCP client');
		assert.deepEqual(client?.redirect_uris, ['https://client.example/oauth/callback']);

		const stored = await getClient(
			db,
			clientId,
			workersFetch(() => {
				throw new Error('a fresh client is served from D1');
			})
		);
		assert.equal(stored?.client_name, 'Example MCP client');
	});

	test('a redirect is refused, not followed', async () => {
		const { db } = createTestDb();
		const redirect = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/meta' } });
		await assert.rejects(
			getClient(db, clientId, workersFetch(redirect)),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_client'
		);
	});

	test('a failed fetch logs the error and the client host, nothing more', async () => {
		const { db } = createTestDb();
		const logged: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};
		try {
			await assert.rejects(
				getClient(db, `${clientId}?session=secret`, (async () => {
					throw new TypeError('Network connection lost.');
				}) as typeof fetch),
				(error: unknown) =>
					error instanceof OAuthError &&
					error.code === 'invalid_client' &&
					error.message === 'Could not fetch the client metadata document'
			);
		} finally {
			console.error = original;
		}
		assert.deepEqual(logged, [
			['Failed to fetch client metadata document', 'client.example', 'TypeError: Network connection lost.']
		]);
	});
});

describe('dynamic registration fallback', () => {
	const origin = 'https://mail.example.com';
	const redirectUri = 'https://client.example/oauth/callback';
	// RFC 7636 appendix B vector.
	const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
	const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
	const noFetch = (async () => {
		throw new Error('a registered client is never fetched');
	}) as typeof fetch;

	test('a client registers at /oauth/register, authorizes, and redeems the code', async () => {
		const { db, sqlite } = createTestDb();
		insertTestUser(sqlite);
		const platform = { env: { DB: db } };
		const getClientAddress = () => '203.0.113.7';

		const discovery = await getAuthorizationServerMetadata({
			url: new URL(`${origin}/.well-known/oauth-authorization-server`)
		} as never);
		const metadata = await discovery.json();
		assert.equal(metadata.client_id_metadata_document_supported, undefined);

		const registration = await postRegister({
			request: new Request(metadata.registration_endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 'Example MCP client',
					redirect_uris: [redirectUri],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code']
				})
			}),
			platform,
			getClientAddress
		} as never);
		assert.equal(registration.status, 201);
		const { client_id: clientId } = await registration.json();
		assert.match(clientId, /^qi_client_/);

		const params = {
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			scope: 'mail:read mail:send',
			state: 'state-1',
			resource: `${origin}/mcp`
		};
		const authorizeUrl = new URL(`${origin}/oauth/authorize?${new URLSearchParams(params)}`);
		const locals = { user: { id: 'user-1' } };

		const consent = (await loadAuthorize({
			url: authorizeUrl,
			locals,
			platform,
			fetch: noFetch,
			setHeaders: () => {}
		} as never)) as { invalid: unknown; request: { client: { client_id: string; client_name: string } } | null };
		assert.equal(consent.invalid, null);
		assert.equal(consent.request?.client.client_id, clientId);
		assert.equal(consent.request?.client.client_name, 'Example MCP client');

		let callback: URL | null = null;
		try {
			await authorizeActions.default({
				request: new Request(authorizeUrl, {
					method: 'POST',
					headers: { origin },
					body: new URLSearchParams({ ...params, decision: 'allow' })
				}),
				url: authorizeUrl,
				locals,
				platform,
				fetch: noFetch
			} as never);
		} catch (thrown) {
			if (!isRedirect(thrown)) throw thrown;
			callback = new URL(thrown.location);
		}
		assert.ok(callback, 'approving redirects back to the client');
		assert.equal(`${callback.origin}${callback.pathname}`, redirectUri);
		assert.equal(callback.searchParams.get('state'), 'state-1');
		assert.equal(callback.searchParams.get('iss'), origin);
		const code = callback.searchParams.get('code');
		assert.ok(code);

		const tokenResponse = await postToken({
			request: new Request(`${origin}/oauth/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					code_verifier: verifier,
					client_id: clientId,
					redirect_uri: redirectUri,
					resource: `${origin}/mcp`
				})
			}),
			platform,
			url: new URL(`${origin}/oauth/token`),
			getClientAddress
		} as never);
		assert.equal(tokenResponse.status, 200);
		const tokens = await tokenResponse.json();
		assert.equal(tokens.scope, 'mail:read mail:send');

		const auth = await getUserByOAuthToken(db, tokens.access_token);
		assert.equal(auth?.user.id, 'user-1');
		assert.equal(auth?.clientId, clientId);
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
		assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
		assert.equal(
			'client_id_metadata_document_supported' in as,
			false,
			'clients register at registration_endpoint instead of sending a metadata document URL'
		);

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
	test('recognises well-known clients from attributable hosts, not names', () => {
		assert.equal(clientBrand({ client_name: 'Claude' }), null);
		assert.equal(clientBrand({ client_name: 'Not Claude', client_uri: 'https://claude.ai' })?.icon, 'claude-fill');
		assert.equal(clientBrand({ client_name: 'Claude', client_uri: 'https://evil.example' }), null);
		assert.equal(clientBrand({ client_name: 'My tool', client_uri: 'https://cursor.com' })?.icon, 'cursor-ai-fill');
		assert.equal(
			clientBrand({
				client_name: 'ChatGPT',
				client_id: 'https://chatgpt.com/.well-known/oauth-client'
			})?.icon,
			'openai-fill'
		);
		assert.equal(
			clientBrand({ client_name: 'MCP Inspector', redirect_uri: 'http://localhost:6274/oauth/callback' })?.icon,
			'terminal-box-line'
		);
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
