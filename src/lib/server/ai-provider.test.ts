import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	AiProviderError,
	chatCompletionsUrl,
	generateText,
	getAiProvider,
	INSTANCE_OWNER,
	resolveAiProvider,
	saveAiProvider,
	type AiEnv,
	type ResolvedAiProvider
} from './ai-provider';
import { createTestDb, insertTestUser } from './test-db';

const env: AiEnv = { ENCRYPTION_KEY: 'e'.repeat(40) };

function setup() {
	const { db, sqlite } = createTestDb();
	insertTestUser(sqlite, 'user-1');
	insertTestUser(sqlite, 'user-2');
	return { db, sqlite };
}

const openai = {
	kind: 'openai',
	baseUrl: 'https://sub2api.example.com/v1/',
	model: 'gpt-5-mini',
	apiKey: 'sk-secret-9876'
};

describe('saveAiProvider', () => {
	test('stores a personal key sealed, showing only its last four characters', async () => {
		const { db, sqlite } = setup();
		const saved = await saveAiProvider(db, env, 'user-1', openai);

		assert.deepEqual(
			{ kind: saved.kind, base_url: saved.base_url, model: saved.model, key_hint: saved.key_hint },
			{ kind: 'openai', base_url: 'https://sub2api.example.com/v1', model: 'gpt-5-mini', key_hint: '9876' }
		);
		const stored = sqlite.query('SELECT api_key FROM ai_providers WHERE owner = ?').all('user-1')[0] as {
			api_key: string;
		};
		assert.ok(!stored.api_key.includes('sk-secret'));
	});

	test('keeps the saved key when only the model changes', async () => {
		const { db } = setup();
		await saveAiProvider(db, env, 'user-1', openai);
		await saveAiProvider(db, env, 'user-1', { ...openai, model: 'gpt-5', apiKey: '' });

		const resolved = await resolveAiProvider(db, env, 'user-1');
		assert.equal(resolved?.model, 'gpt-5');
		assert.equal(resolved?.apiKey, 'sk-secret-9876');
	});

	test('asks for a new key when the base URL changes', async () => {
		const { db } = setup();
		await saveAiProvider(db, env, 'user-1', openai);

		await assert.rejects(
			saveAiProvider(db, env, 'user-1', {
				...openai,
				baseUrl: 'https://elsewhere.example/v1',
				apiKey: ''
			}),
			/API key is required/
		);
		const resolved = await resolveAiProvider(db, env, 'user-1');
		assert.match(resolved?.baseUrl ?? '', /sub2api\.example\.com/);
	});

	test('asks for a new key when switching provider', async () => {
		const { db } = setup();
		await saveAiProvider(db, env, 'user-1', openai);

		await assert.rejects(
			saveAiProvider(db, env, 'user-1', { kind: 'anthropic', apiKey: '' }),
			/API key is required/
		);
	});

	test('only an admin-owned instance provider may use Workers AI', async () => {
		const { db } = setup();
		const withAi: AiEnv = { ...env, AI: { run: async () => ({ response: 'ok' }) } };

		await assert.rejects(
			saveAiProvider(db, withAi, 'user-1', { kind: 'workers_ai' }),
			/supported provider/
		);
		const saved = await saveAiProvider(db, withAi, INSTANCE_OWNER, { kind: 'workers_ai' });
		assert.equal(saved.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
		assert.equal(saved.key_hint, null);
	});

	test('refuses to store a key without ENCRYPTION_KEY', async () => {
		const { db } = setup();
		await assert.rejects(
			saveAiProvider(db, {}, 'user-1', openai),
			(error: unknown) => error instanceof AiProviderError && error.status === 503
		);
	});

	test('requires https and, for OpenAI-compatible servers, a base URL and model', async () => {
		const { db } = setup();
		await assert.rejects(
			saveAiProvider(db, env, 'user-1', { ...openai, baseUrl: 'http://sub2api.example.com/v1' }),
			/https/
		);
		await assert.rejects(saveAiProvider(db, env, 'user-1', { ...openai, baseUrl: '' }), /Base URL/);
		await assert.rejects(saveAiProvider(db, env, 'user-1', { ...openai, model: '' }), /Model/);
	});
});

describe('resolveAiProvider', () => {
	test('a personal key wins over the instance provider', async () => {
		const { db } = setup();
		await saveAiProvider(db, env, INSTANCE_OWNER, { kind: 'anthropic', apiKey: 'sk-ant-shared' });
		await saveAiProvider(db, env, 'user-1', openai);

		assert.equal((await resolveAiProvider(db, env, 'user-1'))?.source, 'user');
		const other = await resolveAiProvider(db, env, 'user-2');
		assert.deepEqual(other, {
			source: 'instance',
			kind: 'anthropic',
			baseUrl: null,
			model: 'claude-opus-5',
			apiKey: 'sk-ant-shared'
		});
	});

	test('is null when nothing is set up', async () => {
		const { db } = setup();
		assert.equal(await resolveAiProvider(db, env, 'user-1'), null);
		assert.equal(await getAiProvider(db, 'user-1'), null);
	});

	test('explains a key that no longer decrypts', async () => {
		const { db } = setup();
		await saveAiProvider(db, env, 'user-1', openai);

		await assert.rejects(
			resolveAiProvider(db, { ENCRYPTION_KEY: 'r'.repeat(40) }, 'user-1'),
			/ENCRYPTION_KEY may have changed/
		);
	});
});

describe('generateText', () => {
	const request = { system: 'Be brief.', prompt: 'Say hi.' };

	test('calls an OpenAI-compatible server with the key and model', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ choices: [{ message: { content: ' Hi there. ' } }] });
		}) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'user',
			kind: 'openai',
			baseUrl: 'https://sub2api.example.com/v1',
			model: 'gpt-5-mini',
			apiKey: 'sk-secret'
		};

		assert.equal(await generateText(env, provider, request, fetcher), 'Hi there.');
		assert.equal(calls[0].url, 'https://sub2api.example.com/v1/chat/completions');
		assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer sk-secret');
		const body = JSON.parse(String(calls[0].init.body));
		assert.equal(body.model, 'gpt-5-mini');
		assert.deepEqual(body.messages[0], { role: 'system', content: 'Be brief.' });
	});

	test('surfaces the error an OpenAI-compatible server returns', async () => {
		const fetcher = (async () =>
			Response.json({ error: { message: 'model not found' } }, { status: 404 })) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'user',
			kind: 'openai',
			baseUrl: 'https://sub2api.example.com/v1',
			model: 'nope',
			apiKey: 'sk'
		};

		await assert.rejects(generateText(env, provider, request, fetcher), /404: model not found/);
	});

	test('refuses to follow a redirect with the key attached', async () => {
		const calls: RequestInit[] = [];
		const fetcher = (async (_url: string, init: RequestInit) => {
			calls.push(init);
			return new Response(null, {
				status: 307,
				headers: { location: 'https://elsewhere.example/v1/chat/completions' }
			});
		}) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'user',
			kind: 'openai',
			baseUrl: 'https://gateway.example.com/v1',
			model: 'gpt-5-mini',
			apiKey: 'sk-secret'
		};

		await assert.rejects(
			generateText(env, provider, request, fetcher),
			/redirected to https:\/\/elsewhere\.example/
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].redirect, 'manual');
	});

	test('calls the Anthropic Messages API', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			calls.push({ url: String(url), init });
			return Response.json({
				id: 'msg_1',
				type: 'message',
				role: 'assistant',
				model: 'claude-opus-5',
				content: [{ type: 'text', text: 'Hello!' }],
				stop_reason: 'end_turn',
				stop_sequence: null,
				usage: { input_tokens: 5, output_tokens: 2 }
			});
		}) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'instance',
			kind: 'anthropic',
			baseUrl: null,
			model: 'claude-opus-5',
			apiKey: 'sk-ant'
		};

		assert.equal(await generateText(env, provider, request, fetcher), 'Hello!');
		assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
		const body = JSON.parse(String(calls[0].init.body));
		assert.equal(body.system, 'Be brief.');
		assert.equal(body.model, 'claude-opus-5');
	});

	test('does not let the Anthropic client follow a redirect with the key', async () => {
		const calls: RequestInit[] = [];
		const fetcher = (async (_url: string, init: RequestInit) => {
			calls.push(init);
			return new Response(null, {
				status: 307,
				headers: { location: 'https://elsewhere.example/v1/messages' }
			});
		}) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'user',
			kind: 'anthropic',
			baseUrl: 'https://proxy.example.com',
			model: 'claude-opus-5',
			apiKey: 'sk-ant'
		};

		await assert.rejects(generateText(env, provider, request, fetcher), /307/);
		assert.ok(calls.length > 0);
		assert.ok(calls.every((init) => init.redirect === 'manual'));
	});

	test('reports a refusal instead of an empty draft', async () => {
		const fetcher = (async () =>
			Response.json({
				id: 'msg_1',
				type: 'message',
				role: 'assistant',
				model: 'claude-opus-5',
				content: [],
				stop_reason: 'refusal',
				stop_sequence: null,
				usage: { input_tokens: 5, output_tokens: 0 }
			})) as unknown as typeof fetch;
		const provider: ResolvedAiProvider = {
			source: 'user',
			kind: 'anthropic',
			baseUrl: null,
			model: 'claude-opus-5',
			apiKey: 'sk-ant'
		};

		await assert.rejects(generateText(env, provider, request, fetcher), /declined/);
	});

	test('runs Workers AI through the binding', async () => {
		const runs: { model: string; inputs: Record<string, unknown> }[] = [];
		const withAi: AiEnv = {
			AI: {
				async run(model, inputs) {
					runs.push({ model, inputs });
					return { response: 'From the edge.' };
				}
			}
		};
		const provider: ResolvedAiProvider = {
			source: 'instance',
			kind: 'workers_ai',
			baseUrl: null,
			model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
			apiKey: null
		};

		assert.equal(await generateText(withAi, provider, request), 'From the edge.');
		assert.equal(runs[0].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
		assert.ok(Number(runs[0].inputs.max_tokens) > 256);
	});
});

describe('chatCompletionsUrl', () => {
	test('accepts the API root or the full endpoint', () => {
		assert.equal(chatCompletionsUrl('https://x.test/v1'), 'https://x.test/v1/chat/completions');
		assert.equal(chatCompletionsUrl('https://x.test/v1/chat/completions/'), 'https://x.test/v1/chat/completions');
	});
});
