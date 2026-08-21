import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { authorizeApiRequest, authorizeMailAction } from './api-access';
import { parseScopes } from './api-tokens';

describe('API key access', () => {
	test('sessions are unrestricted', () => {
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/apikeys',
				method: 'POST',
				authMethod: 'session',
				scopes: []
			}),
			{ ok: true }
		);
	});

	test('a read key cannot send or manage keys', () => {
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/mail',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:read']
			}).ok,
			false
		);
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/apikeys',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}).ok,
			false
		);
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/push/subscriptions',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}).ok,
			false
		);
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/push/subscriptions',
				method: 'GET',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}).ok,
			false
		);
	});

	test('a read key can list and open threads', () => {
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/mail',
				method: 'GET',
				authMethod: 'api_token',
				scopes: ['mail:read']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/mail/abc',
				method: 'GET',
				authMethod: 'api_token',
				scopes: ['mail:read']
			}),
			{ ok: true }
		);
	});

	test('admin routes stay off mail keys', () => {
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/admin/users',
				method: 'GET',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}).ok,
			false
		);
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/admin/users',
				method: 'GET',
				authMethod: 'api_token',
				scopes: ['admin']
			}),
			{ ok: true }
		);
	});

	test('parseScopes rejects admin unless allowed', () => {
		assert.equal(parseScopes(['mail:read', 'admin'], false), null);
		assert.deepEqual(parseScopes(['mail:read', 'admin'], true), ['mail:read', 'admin']);
		assert.equal(parseScopes(['mail:write'], true), null);
	});

	test('POST /api/mail/actions is allowed for read or send keys', () => {
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/mail/actions',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:read']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/mail/actions',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:send']
			}),
			{ ok: true }
		);
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/mail/actions',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['admin']
			}).ok,
			false
		);
	});

	test('creating an address stays admin-only for API keys', () => {
		assert.equal(
			authorizeApiRequest({
				pathname: '/api/addresses',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['mail:send']
			}).ok,
			false
		);
		assert.deepEqual(
			authorizeApiRequest({
				pathname: '/api/addresses',
				method: 'POST',
				authMethod: 'api_token',
				scopes: ['admin']
			}),
			{ ok: true }
		);
	});

	test('mailbox flag actions need mail:read; destructive actions need both scopes', () => {
		assert.deepEqual(
			authorizeMailAction({ action: 'star', authMethod: 'session', scopes: [] }),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({ action: 'empty-trash', authMethod: 'session', scopes: [] }),
			{ ok: true }
		);

		assert.deepEqual(
			authorizeMailAction({ action: 'read', authMethod: 'api_token', scopes: ['mail:read'] }),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({ action: 'unread', authMethod: 'api_token', scopes: ['mail:read'] }),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({ action: 'star', authMethod: 'api_token', scopes: ['mail:read'] }),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({ action: 'unstar', authMethod: 'api_token', scopes: ['mail:read'] }),
			{ ok: true }
		);

		assert.equal(
			authorizeMailAction({ action: 'star', authMethod: 'api_token', scopes: ['mail:send'] }).ok,
			false
		);
		assert.equal(
			authorizeMailAction({ action: 'trash', authMethod: 'api_token', scopes: ['mail:read'] }).ok,
			false
		);
		assert.equal(
			authorizeMailAction({ action: 'delete', authMethod: 'api_token', scopes: ['mail:send'] }).ok,
			false
		);
		assert.equal(
			authorizeMailAction({
				action: 'empty-trash',
				authMethod: 'api_token',
				scopes: ['mail:send']
			}).ok,
			false
		);
		assert.equal(
			authorizeMailAction({
				action: 'read-all',
				authMethod: 'api_token',
				scopes: ['mail:read']
			}).ok,
			false
		);

		assert.deepEqual(
			authorizeMailAction({
				action: 'trash',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({
				action: 'restore',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({
				action: 'delete',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({
				action: 'read-all',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}),
			{ ok: true }
		);
		assert.deepEqual(
			authorizeMailAction({
				action: 'empty-trash',
				authMethod: 'api_token',
				scopes: ['mail:read', 'mail:send']
			}),
			{ ok: true }
		);
	});
});
