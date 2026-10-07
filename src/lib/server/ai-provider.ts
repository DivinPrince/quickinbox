import Anthropic from '@anthropic-ai/sdk';
import type { D1Database } from '@cloudflare/workers-types';
import { configuredEncryptionKey, openSecret, sealSecret } from './secret-box';

/**
 * Where AI drafting runs. An admin can set one provider for the whole instance
 * — Workers AI on this Cloudflare account, or a shared API key — and anyone can
 * bring their own key, which wins for them. Keys are sealed with ENCRYPTION_KEY
 * (secret-box.ts) and only ever opened here, just before a request.
 */

export const AI_PROVIDER_KINDS = ['workers_ai', 'openai', 'anthropic'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Workers AI bills the instance's own Cloudflare account, so only an admin can pick it. */
export const PERSONAL_PROVIDER_KINDS: readonly AiProviderKind[] = ['openai', 'anthropic'];

export const INSTANCE_OWNER = 'instance';

/** OpenAI-compatible servers each name their own models, so that one has no default. */
export const DEFAULT_MODELS: Record<AiProviderKind, string> = {
	workers_ai: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
	openai: '',
	anthropic: 'claude-opus-5'
};

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_URL = 500;
const MAX_MODEL = 200;
const MAX_KEY = 1_000;

export type WorkersAiBinding = {
	run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
};

export type AiEnv = { AI?: WorkersAiBinding; ENCRYPTION_KEY?: string };

/** What Settings may show about a provider: never the key itself. */
export type AiProviderSummary = {
	kind: AiProviderKind;
	base_url: string | null;
	model: string;
	key_hint: string | null;
	updated_at: string;
};

export type ResolvedAiProvider = {
	source: 'user' | 'instance';
	kind: AiProviderKind;
	baseUrl: string | null;
	model: string;
	apiKey: string | null;
};

export type AiProviderInput = {
	kind?: unknown;
	baseUrl?: unknown;
	model?: unknown;
	apiKey?: unknown;
};

export class AiProviderError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
		this.name = 'AiProviderError';
	}
}

type ProviderRow = AiProviderSummary & { owner: string; api_key: string | null };

function summary(row: ProviderRow): AiProviderSummary {
	return {
		kind: row.kind,
		base_url: row.base_url,
		model: row.model,
		key_hint: row.key_hint,
		updated_at: row.updated_at
	};
}

function sealContext(owner: string): string {
	return `ai_providers:${owner}`;
}

async function readRow(db: D1Database, owner: string): Promise<ProviderRow | null> {
	return db
		.prepare(
			`SELECT owner, kind, base_url, model, api_key, key_hint, updated_at
			 FROM ai_providers WHERE owner = ?`
		)
		.bind(owner)
		.first<ProviderRow>();
}

export async function getAiProvider(db: D1Database, owner: string): Promise<AiProviderSummary | null> {
	const row = await readRow(db, owner);
	return row ? summary(row) : null;
}

function text(value: unknown, max: number, field: string): string {
	if (value == null) return '';
	if (typeof value !== 'string') throw new AiProviderError(`${field} must be text`);
	const trimmed = value.trim();
	if (trimmed.length > max) throw new AiProviderError(`${field} is too long`);
	return trimmed;
}

function httpsUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new AiProviderError('Base URL must be a full URL, like https://api.example.com/v1');
	}
	if (url.protocol !== 'https:') throw new AiProviderError('Base URL must use https');
	return value.replace(/\/+$/, '');
}

/**
 * Create or replace a provider. Leaving the key blank keeps the saved one, but
 * only for the same kind and base URL, so a stored key never moves to a new host.
 */
export async function saveAiProvider(
	db: D1Database,
	env: AiEnv,
	owner: string,
	input: AiProviderInput
): Promise<AiProviderSummary> {
	const allowed = owner === INSTANCE_OWNER ? AI_PROVIDER_KINDS : PERSONAL_PROVIDER_KINDS;
	const kind = allowed.find((candidate) => candidate === input.kind);
	if (!kind) throw new AiProviderError('Choose a supported provider');

	const model = text(input.model, MAX_MODEL, 'Model') || DEFAULT_MODELS[kind];
	if (!model) throw new AiProviderError('Model is required');

	let baseUrl: string | null = null;
	let apiKey: string | null = null;
	let keyHint: string | null = null;

	if (kind === 'workers_ai') {
		if (!env.AI) {
			throw new AiProviderError('Workers AI is not bound to this Worker. Add the "ai" binding to wrangler.jsonc.');
		}
	} else {
		const rawUrl = text(input.baseUrl, MAX_URL, 'Base URL');
		if (kind === 'openai' && !rawUrl) throw new AiProviderError('Base URL is required');
		baseUrl = rawUrl ? httpsUrl(rawUrl) : null;

		const newKey = text(input.apiKey, MAX_KEY, 'API key');
		const existing = await readRow(db, owner);
		if (newKey) {
			const secret = configuredEncryptionKey(env.ENCRYPTION_KEY);
			if (!secret) {
				throw new AiProviderError(
					'This server cannot store API keys yet: set the ENCRYPTION_KEY secret first.',
					503
				);
			}
			apiKey = await sealSecret(secret, newKey, sealContext(owner));
			keyHint = newKey.slice(-4);
		} else if (existing?.api_key && existing.kind === kind && existing.base_url === baseUrl) {
			apiKey = existing.api_key;
			keyHint = existing.key_hint;
		} else {
			throw new AiProviderError('API key is required');
		}
	}

	await db
		.prepare(
			`INSERT INTO ai_providers (owner, user_id, kind, base_url, model, api_key, key_hint, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(owner) DO UPDATE SET
			   kind = excluded.kind,
			   base_url = excluded.base_url,
			   model = excluded.model,
			   api_key = excluded.api_key,
			   key_hint = excluded.key_hint,
			   updated_at = excluded.updated_at`
		)
		.bind(
			owner,
			owner === INSTANCE_OWNER ? null : owner,
			kind,
			baseUrl,
			model,
			apiKey,
			keyHint
		)
		.run();

	const saved = await getAiProvider(db, owner);
	if (!saved) throw new AiProviderError('The provider was not saved', 500);
	return saved;
}

export async function deleteAiProvider(db: D1Database, owner: string): Promise<void> {
	await db.prepare('DELETE FROM ai_providers WHERE owner = ?').bind(owner).run();
}

/** Open a saved provider for use: the user's own if they set one, else the instance's. */
export async function resolveAiProvider(
	db: D1Database,
	env: AiEnv,
	userId: string
): Promise<ResolvedAiProvider | null> {
	const row = (await readRow(db, userId)) ?? (await readRow(db, INSTANCE_OWNER));
	if (!row) return null;
	return openProvider(env, row);
}

/** The instance provider alone — what an admin tests from the admin page. */
export async function resolveInstanceAiProvider(
	db: D1Database,
	env: AiEnv
): Promise<ResolvedAiProvider | null> {
	const row = await readRow(db, INSTANCE_OWNER);
	return row ? openProvider(env, row) : null;
}

async function openProvider(env: AiEnv, row: ProviderRow): Promise<ResolvedAiProvider> {
	const source = row.owner === INSTANCE_OWNER ? 'instance' : 'user';
	let apiKey: string | null = null;
	if (row.api_key) {
		const secret = configuredEncryptionKey(env.ENCRYPTION_KEY);
		if (!secret) {
			throw new AiProviderError('Saved API keys cannot be read: ENCRYPTION_KEY is not set.', 503);
		}
		try {
			apiKey = await openSecret(secret, row.api_key, sealContext(row.owner));
		} catch {
			throw new AiProviderError(
				'The saved API key could not be decrypted — ENCRYPTION_KEY may have changed. Save the key again.',
				503
			);
		}
	}
	return { source, kind: row.kind, baseUrl: row.base_url, model: row.model, apiKey };
}

/** A connection test that costs a few tokens: proves the URL, key and model all work. */
export async function testAiProvider(env: AiEnv, provider: ResolvedAiProvider): Promise<string> {
	const reply = await generateText(env, provider, {
		system: 'You are checking that an API connection works.',
		prompt: 'Reply with the single word OK.',
		maxTokens: 1_024
	});
	return reply.slice(0, 200);
}

/** JSON error for the settings routes; anything unexpected is rethrown. */
export function aiErrorResponse(error: unknown): Response {
	if (error instanceof AiProviderError) {
		return Response.json({ error: error.message }, { status: error.status });
	}
	throw error;
}

export type TextRequest = {
	system: string;
	prompt: string;
	/** Output ceiling where the provider needs one; Anthropic counts thinking against it. */
	maxTokens?: number;
};

export async function generateText(
	env: AiEnv,
	provider: ResolvedAiProvider,
	request: TextRequest,
	fetcher: typeof fetch = fetch
): Promise<string> {
	const output = await (async () => {
		switch (provider.kind) {
			case 'workers_ai':
				return workersAiText(env, provider, request);
			case 'openai':
				return openAiCompatibleText(provider, request, fetcher);
			case 'anthropic':
				return anthropicText(provider, request, fetcher);
			default: {
				const _never: never = provider.kind;
				return _never;
			}
		}
	})();
	const trimmed = output.trim();
	if (!trimmed) throw new AiProviderError('The model returned an empty response', 502);
	return trimmed;
}

async function workersAiText(
	env: AiEnv,
	provider: ResolvedAiProvider,
	request: TextRequest
): Promise<string> {
	if (!env.AI) throw new AiProviderError('Workers AI is not bound to this Worker', 503);
	let result: unknown;
	try {
		result = await env.AI.run(provider.model, {
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.prompt }
			],
			// Workers AI text models default to 256 tokens, too short for a reply.
			max_tokens: request.maxTokens ?? 2_048
		});
	} catch (error) {
		throw new AiProviderError(
			`Workers AI failed: ${error instanceof Error ? error.message : 'unknown error'}`,
			502
		);
	}
	// Cloudflare-hosted models answer { response }; partner models answer in OpenAI's shape.
	const shaped = result as { response?: unknown } | null;
	if (typeof shaped?.response === 'string') return shaped.response;
	return chatCompletionText(result);
}

function chatCompletionText(body: unknown): string {
	const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
		?.message?.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part?.text === 'string' ? part.text : ''))
			.join('');
	}
	return '';
}

/** Accepts the API root (…/v1) or the full …/chat/completions URL. */
export function chatCompletionsUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, '');
	return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

async function openAiCompatibleText(
	provider: ResolvedAiProvider,
	request: TextRequest,
	fetcher: typeof fetch
): Promise<string> {
	if (!provider.baseUrl || !provider.apiKey) {
		throw new AiProviderError('The OpenAI-compatible provider is missing its URL or key', 503);
	}
	let response: Response;
	try {
		response = await fetcher(chatCompletionsUrl(provider.baseUrl), {
			method: 'POST',
			// Never follow a redirect with the key attached: on compatibility dates
			// before 2025-09-01, Workers keep Authorization across origins.
			redirect: 'manual',
			headers: {
				Authorization: `Bearer ${provider.apiKey}`,
				'Content-Type': 'application/json'
			},
			// No token cap: servers disagree on max_tokens vs max_completion_tokens,
			// and a reply is short on its own.
			body: JSON.stringify({
				model: provider.model,
				messages: [
					{ role: 'system', content: request.system },
					{ role: 'user', content: request.prompt }
				]
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		throw new AiProviderError(
			`Could not reach ${new URL(provider.baseUrl).host}: ${error instanceof Error ? error.message : 'network error'}`,
			502
		);
	}

	if (response.status >= 300 && response.status < 400) {
		const target = response.headers.get('location');
		throw new AiProviderError(
			`The provider redirected${target ? ` to ${target}` : ''}. Use the address it redirects to as the base URL.`.slice(0, 500),
			502
		);
	}

	const body = (await response.json().catch(() => null)) as {
		error?: { message?: unknown } | string;
	} | null;
	if (!response.ok) {
		const detail =
			typeof body?.error === 'string'
				? body.error
				: typeof body?.error?.message === 'string'
					? body.error.message
					: response.statusText;
		throw new AiProviderError(`The provider answered ${response.status}: ${detail}`.slice(0, 500), 502);
	}
	return chatCompletionText(body);
}

async function anthropicText(
	provider: ResolvedAiProvider,
	request: TextRequest,
	fetcher: typeof fetch
): Promise<string> {
	if (!provider.apiKey) throw new AiProviderError('The Anthropic provider has no API key', 503);
	const client = new Anthropic({
		apiKey: provider.apiKey,
		...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
		// x-api-key is a custom header, which fetch keeps across a cross-origin
		// redirect. A 3xx comes back to the SDK as an error instead.
		fetch: ((url: string | URL | Request, init?: RequestInit) =>
			fetcher(url, { ...init, redirect: 'manual' })) as typeof fetch,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: 1
	});

	let message: Anthropic.Message;
	try {
		message = await client.messages.create({
			model: provider.model,
			max_tokens: request.maxTokens ?? 16_000,
			system: request.system,
			messages: [{ role: 'user', content: request.prompt }]
		});
	} catch (error) {
		if (error instanceof Anthropic.AuthenticationError) {
			throw new AiProviderError('Anthropic rejected the API key', 502);
		}
		if (error instanceof Anthropic.APIError) {
			throw new AiProviderError(`Anthropic answered ${error.status ?? 'an error'}: ${error.message}`, 502);
		}
		throw error;
	}

	if (message.stop_reason === 'refusal') {
		throw new AiProviderError('The model declined to write this', 502);
	}
	return message.content
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('');
}
