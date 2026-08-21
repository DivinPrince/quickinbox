import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
	createQuickMailClient,
	QuickMailAccessError,
	QuickMailClient,
	QuickMailError,
	safeDownloadName
} from './client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>): void {
	globalThis.fetch = handler as typeof fetch;
}

function accessClient(): QuickMailClient {
	return new QuickMailClient('https://mail.example.com', 'qm_live_secret', {
		cfAccessClientId: 'access-id.access',
		cfAccessClientSecret: 'access-secret'
	});
}

describe('safeDownloadName', () => {
	test('strips directory components and absolute paths', () => {
		assert.equal(safeDownloadName('../../.ssh/authorized_keys'), 'authorized_keys');
		assert.equal(safeDownloadName('/tmp/payload'), 'payload');
		assert.equal(safeDownloadName('C:\\Windows\\win.ini'), 'win.ini');
		assert.equal(safeDownloadName('invoice.pdf'), 'invoice.pdf');
	});

	test('falls back when the name is empty or a traversal residue', () => {
		assert.equal(safeDownloadName(''), 'attachment');
		assert.equal(safeDownloadName('..'), 'attachment');
		assert.equal(safeDownloadName('/'), 'attachment');
	});
});

describe('Cloudflare Access request handling', () => {
	test('injects both auth layers and disables redirects for JSON requests', async () => {
		let captured: RequestInit | undefined;
		stubFetch((_input, init) => {
			captured = init;
			return new Response(JSON.stringify({ user: { id: 'u1', email: 'me@example.com', name: 'Me', is_admin: false } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		await accessClient().whoami();
		const headers = new Headers(captured?.headers);
		assert.equal(headers.get('authorization'), 'Bearer qm_live_secret');
		assert.equal(headers.get('cf-access-client-id'), 'access-id.access');
		assert.equal(headers.get('cf-access-client-secret'), 'access-secret');
		assert.equal(headers.get('accept'), 'application/json');
		assert.equal(captured?.redirect, 'manual');
	});

	test('uses the same auth headers and redirect policy for attachment downloads', async () => {
		let captured: RequestInit | undefined;
		stubFetch((_input, init) => {
			captured = init;
			return new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: {
					'content-type': 'application/octet-stream',
					'content-disposition': 'attachment; filename="invoice.pdf"'
				}
			});
		});

		const file = await accessClient().downloadAttachment('email', 'attachment');
		const headers = new Headers(captured?.headers);
		assert.equal(headers.get('authorization'), 'Bearer qm_live_secret');
		assert.equal(headers.get('cf-access-client-id'), 'access-id.access');
		assert.equal(headers.get('cf-access-client-secret'), 'access-secret');
		assert.equal(captured?.redirect, 'manual');
		assert.deepEqual(file.bytes, new Uint8Array([1, 2, 3]));
	});

	test('downloads legitimate HTML attachments instead of treating them as an Access page', async () => {
		stubFetch(
			() =>
				new Response('<html><body>saved report</body></html>', {
					status: 200,
					headers: {
						'content-type': 'text/html; charset=utf-8',
						'content-disposition': 'attachment; filename="report.html"'
					}
				})
		);

		const attachment = await accessClient().downloadAttachment('email-1', 'attachment-1');
		assert.equal(attachment.filename, 'report.html');
		assert.equal(new TextDecoder().decode(attachment.bytes), '<html><body>saved report</body></html>');
	});

	test('still rejects an HTML Access page returned from an attachment route', async () => {
		stubFetch(
			() =>
				new Response('<html>Access login</html>', {
					status: 200,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
		);

		await assert.rejects(
			accessClient().downloadAttachment('email-1', 'attachment-1'),
			QuickMailAccessError
		);
	});

	test('rejects non-success HTML even when it claims to be an attachment', async () => {
		stubFetch(
			() =>
				new Response('<html>Access denied</html>', {
					status: 403,
					headers: {
						'content-type': 'text/html; charset=utf-8',
						'content-disposition': 'attachment; filename="denied.html"'
					}
				})
		);

		await assert.rejects(
			accessClient().downloadAttachment('email-1', 'attachment-1'),
			QuickMailAccessError
		);
	});

	test('preserves existing bearer-only behavior when Access is disabled', async () => {
		let captured: RequestInit | undefined;
		stubFetch((_input, init) => {
			captured = init;
			return new Response(JSON.stringify({ threads: [], total: 0, page: 1, pageCount: 1, pageSize: 25 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		await new QuickMailClient('https://mail.example.com', 'qm_live_secret').listThreads();
		const headers = new Headers(captured?.headers);
		assert.equal(headers.get('authorization'), 'Bearer qm_live_secret');
		assert.equal(headers.has('cf-access-client-id'), false);
		assert.equal(headers.has('cf-access-client-secret'), false);
	});

	test('creates CLI and MCP clients from the same complete configuration', async () => {
		let captured: RequestInit | undefined;
		stubFetch((_input, init) => {
			captured = init;
			return new Response(JSON.stringify({ user: { id: 'u1', email: 'me@example.com', name: 'Me', is_admin: false } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});

		await createQuickMailClient({
			url: 'https://mail.example.com',
			token: 'qm_live_secret',
			cfAccessClientId: 'access-id.access',
			cfAccessClientSecret: 'access-secret'
		}).whoami();
		const headers = new Headers(captured?.headers);
		assert.equal(headers.get('cf-access-client-id'), 'access-id.access');
		assert.equal(headers.get('cf-access-client-secret'), 'access-secret');
	});

	test('rejects a half-configured Access pair before making a request', () => {
		assert.throws(
			() =>
				new QuickMailClient('https://mail.example.com', 'qm_live_secret', {
					cfAccessClientId: 'access-id.access'
				}),
			/Cloudflare Access client ID and secret must be configured together/
		);
	});

	test('reports an Access redirect distinctly without exposing credentials', async () => {
		stubFetch(
			() =>
				new Response(null, {
					status: 302,
					headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/example' }
				})
		);

		await assert.rejects(accessClient().whoami(), (error: unknown) => {
			assert.ok(error instanceof QuickMailAccessError);
			assert.match(error.message, /Cloudflare Access/);
			assert.doesNotMatch(error.message, /access-id|access-secret|qm_live_secret/);
			return true;
		});
	});

	test('reports an HTML Access response distinctly without reading or echoing its body', async () => {
		stubFetch(
			() =>
				new Response('<html>secret login challenge</html>', {
					status: 200,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
		);

		await assert.rejects(accessClient().whoami(), (error: unknown) => {
			assert.ok(error instanceof QuickMailAccessError);
			assert.doesNotMatch(error.message, /secret login challenge|access-secret|qm_live_secret/);
			return true;
		});
	});

	test('never exposes malformed credentials rejected while constructing headers', async () => {
		let calls = 0;
		stubFetch(() => {
			calls += 1;
			return new Response(JSON.stringify({ user: { id: 'u1' } }), {
				headers: { 'content-type': 'application/json' }
			});
		});
		const delCredential = `TOKEN_DEL_${String.fromCharCode(0x7f)}_MARK`;
		const cases = [
			{
				secret: 'TOKEN_BAD_93f\nINJECTED',
				createClient: () => new QuickMailClient('https://mail.example.com', 'TOKEN_BAD_93f\nINJECTED', {
					cfAccessClientId: 'safe-id.access',
					cfAccessClientSecret: 'safe-secret'
				})
			},
			{
				secret: 'ACCESS_ID_BAD_93f\nINJECTED',
				createClient: () => new QuickMailClient('https://mail.example.com', 'safe-token', {
					cfAccessClientId: 'ACCESS_ID_BAD_93f\nINJECTED',
					cfAccessClientSecret: 'safe-secret'
				})
			},
			{
				secret: 'ACCESS_SECRET_BAD_93f😀',
				createClient: () => new QuickMailClient('https://mail.example.com', 'safe-token', {
					cfAccessClientId: 'safe-id.access',
					cfAccessClientSecret: 'ACCESS_SECRET_BAD_93f😀'
				})
			},
			{
				secret: delCredential,
				createClient: () => new QuickMailClient('https://mail.example.com', delCredential, {
					cfAccessClientId: 'safe-id.access',
					cfAccessClientSecret: 'safe-secret'
				})
			}
		];

		for (const entry of cases) {
			assert.throws(entry.createClient, (error: unknown) => {
				if (!(error instanceof Error)) return false;
				assert.match(error.message, /Authentication credentials contain invalid characters/);
				assert.equal(error.message.includes(entry.secret), false);
				assert.doesNotMatch(
					error.message,
					/TOKEN_BAD|TOKEN_DEL|ACCESS_ID_BAD|ACCESS_SECRET_BAD|INJECTED|MARK/
				);
				return true;
			});
		}
		assert.equal(calls, 0);
	});

	test('redacts credentials from transport exceptions', async () => {
		stubFetch(() => {
			throw new Error('network qm_live_secret access-id.access access-secret');
		});

		await assert.rejects(accessClient().whoami(), (error: unknown) => {
			if (!(error instanceof QuickMailError)) return false;
			assert.doesNotMatch(error.message, /qm_live_secret|access-id\.access|access-secret/);
			assert.match(error.message, /\[REDACTED\]/);
			return true;
		});
	});

	test('fully redacts credentials that overlap by prefix', async () => {
		stubFetch(() => {
			throw new Error('network shared shared-id shared-id-secret');
		});
		const client = new QuickMailClient('https://mail.example.com', 'shared', {
			cfAccessClientId: 'shared-id',
			cfAccessClientSecret: 'shared-id-secret'
		});

		await assert.rejects(client.whoami(), (error: unknown) => {
			if (!(error instanceof QuickMailError)) return false;
			assert.equal(error.message, 'network [REDACTED] [REDACTED] [REDACTED]');
			return true;
		});
	});

	test('redacts all credentials if an API error reflects them', async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({
						error: 'qm_live_secret access-id.access access-secret'
					}),
					{
						status: 400,
						headers: { 'content-type': 'application/json' }
					}
				)
		);

		await assert.rejects(accessClient().listThreads(), (error: unknown) => {
			if (!(error instanceof QuickMailError)) return false;
			assert.doesNotMatch(error.message, /qm_live_secret|access-id\.access|access-secret/);
			assert.match(error.message, /\[REDACTED\]/);
			return true;
		});
	});

	test('keeps QuickMail JSON authorization errors distinct from Access failures', async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ error: 'Missing scope: mail:read' }), {
					status: 403,
					headers: { 'content-type': 'application/json' }
				})
		);

		await assert.rejects(accessClient().listThreads(), (error: unknown) => {
			assert.ok(error instanceof QuickMailError);
			assert.equal(error instanceof QuickMailAccessError, false);
			assert.equal(error.status, 403);
			assert.equal(error.message, 'Missing scope: mail:read');
			return true;
		});
	});
});
