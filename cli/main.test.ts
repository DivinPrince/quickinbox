import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, test } from 'node:test';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		)
	);
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixtureServer(onRequest: (request: IncomingMessage) => void): Promise<string> {
	const server = createServer((request, response) => {
		onRequest(request);
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				user: { id: 'user-1', email: 'me@example.com', name: 'Me', is_admin: false }
			})
		);
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
	return `http://127.0.0.1:${address.port}`;
}

async function configPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'quickmail-login-test-'));
	temporaryDirectories.push(directory);
	return join(directory, 'config.json');
}

async function runCli(
	args: string[],
	path: string,
	environment: Record<string, string | undefined> = {}
) {
	return execFileAsync(process.execPath, ['cli/main.ts', ...args], {
		cwd: new URL('..', import.meta.url),
		env: {
			...process.env,
			QUICKMAIL_CONFIG: path,
			QUICKMAIL_URL: undefined,
			QUICKMAIL_TOKEN: undefined,
			QUICKMAIL_CF_ACCESS_CLIENT_ID: undefined,
			QUICKMAIL_CF_ACCESS_CLIENT_SECRET: undefined,
			...environment
		}
	});
}

describe('quickmail login Cloudflare Access flags', () => {
	test('uses both auth layers for login and saves the complete pair', async () => {
		let request: IncomingMessage | undefined;
		const url = await fixtureServer((value) => {
			request = value;
		});
		const path = await configPath();

		const result = await runCli(
			[
				'login',
				'--url',
				url,
				'--token',
				'qm_live_test',
				'--cf-access-client-id',
				'login-id.access',
				'--cf-access-client-secret',
				'login-secret'
			],
			path
		);

		assert.match(result.stdout, /Logged in as me@example.com/);
		assert.equal(request?.headers.authorization, 'Bearer qm_live_test');
		assert.equal(request?.headers['cf-access-client-id'], 'login-id.access');
		assert.equal(request?.headers['cf-access-client-secret'], 'login-secret');
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
			url,
			token: 'qm_live_test',
			cfAccessClientId: 'login-id.access',
			cfAccessClientSecret: 'login-secret'
		});
	});

	test('rejects a half-configured flag pair before contacting QuickMail or echoing the secret', async () => {
		let requestCount = 0;
		const url = await fixtureServer(() => {
			requestCount += 1;
		});
		const path = await configPath();

		await assert.rejects(
			runCli(
				[
					'login',
					'--url',
					url,
					'--token',
					'qm_live_test',
					'--cf-access-client-secret',
					'login-secret'
				],
				path
			),
			(error: unknown) => {
				if (!error || typeof error !== 'object') return false;
				const stderr = String((error as { stderr?: string }).stderr ?? '');
				assert.match(stderr, /Cloudflare Access client ID and secret must be configured together/);
				assert.doesNotMatch(stderr, /login-secret|qm_live_test/);
				return true;
			}
		);
		assert.equal(requestCount, 0);
	});

	test('rejects mixed or valueless flag and environment Access pairs before contacting QuickMail', async () => {
		let requestCount = 0;
		const url = await fixtureServer(() => {
			requestCount += 1;
		});

		for (const scenario of [
			{
				args: ['--cf-access-client-secret', 'flag-secret'],
				environment: { QUICKMAIL_CF_ACCESS_CLIENT_ID: 'env-id.access' }
			},
			{
				args: ['--cf-access-client-id', 'flag-id.access'],
				environment: { QUICKMAIL_CF_ACCESS_CLIENT_SECRET: 'env-secret' }
			},
			{
				args: ['--cf-access-client-id'],
				environment: {
					QUICKMAIL_CF_ACCESS_CLIENT_ID: 'env-id.access',
					QUICKMAIL_CF_ACCESS_CLIENT_SECRET: 'env-secret'
				}
			},
			{
				args: ['--cf-access-client-secret'],
				environment: {
					QUICKMAIL_CF_ACCESS_CLIENT_ID: 'env-id.access',
					QUICKMAIL_CF_ACCESS_CLIENT_SECRET: 'env-secret'
				}
			}
		]) {
			const path = await configPath();
			await assert.rejects(
				runCli(
					['login', '--url', url, '--token', 'qm_live_test', ...scenario.args],
					path,
					scenario.environment
				),
				(error: unknown) => {
					if (!error || typeof error !== 'object') return false;
					const stderr = String((error as { stderr?: string }).stderr ?? '');
					assert.match(stderr, /Cloudflare Access client ID and secret must be configured together/);
					assert.doesNotMatch(stderr, /flag-secret|flag-id|env-secret|env-id|qm_live_test/);
					return true;
				}
			);
		}

		assert.equal(requestCount, 0);
	});
});
