import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RequestSchema, type Notification } from '@modelcontextprotocol/sdk/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { getUserByApiToken, readBearerToken } from './api-tokens';
import { getUserByOAuthToken } from './oauth';
import { getThreadKey } from './mail-store';
import { hashToken } from './crypto';

export const MAIL_EVENT_NAME = 'email.received';
export const SUBSCRIPTION_META_KEY = 'io.modelcontextprotocol/subscriptionId';

export const NewMailEventSchema = z.object({
	eventId: z.string(),
	timestamp: z.string().datetime(),
	data: z.object({
		emailId: z.string(),
		threadId: z.string(),
		source: z.enum(['resend', 'cloudflare'])
	})
});
export type NewMailEvent = z.infer<typeof NewMailEventSchema>;

export const MAIL_EVENT_DEFINITION = {
	name: MAIL_EVENT_NAME,
	description:
		'A new inbound message and its attachments have been stored in your mailbox. ' +
		'Use emailId or threadId with get_thread on the mail MCP server. ' +
		'Classification may still be running. This stream includes mail later classified as spam.',
	delivery: ['stream'],
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	payloadSchema: {
		type: 'object',
		properties: {
			emailId: { type: 'string' },
			threadId: { type: 'string' },
			source: { type: 'string', enum: ['resend', 'cloudflare'] }
		},
		required: ['emailId', 'threadId', 'source'],
		additionalProperties: false
	}
} as const;

type EventNotification = Notification & {
	method: `notifications/events/${'active' | 'event' | 'terminated'}`;
};
const StreamRequestSchema = RequestSchema.extend({
	method: z.literal('events/stream'),
	params: z.object({
		name: z.literal(MAIL_EVENT_NAME),
		arguments: z.object({}).strict(),
		_meta: z.record(z.string(), z.unknown()).optional()
	})
});
const ListRequestSchema = RequestSchema.extend({ method: z.literal('events/list') });

export type MailEventSubscriber = {
	send: (event: NewMailEvent) => Promise<void>;
	stop: () => void;
};

/** Events are an experimental extension, separate from the stateless mail tools. */
export function createMailEventServer(subscribers: Set<MailEventSubscriber>) {
	const server = new Server<z.infer<typeof StreamRequestSchema>, EventNotification>(
		{ name: 'quickinbox-events', version: '1.0.0' },
		{ capabilities: { experimental: { events: {} } } }
	);
	server.setRequestHandler(ListRequestSchema, () => ({ events: [MAIL_EVENT_DEFINITION] }));
	server.setRequestHandler(StreamRequestSchema, async (_request, extra) => {
		if (subscribers.size >= 16) {
			throw new McpError(ErrorCode.InvalidRequest, 'Too many active event subscriptions');
		}
		const meta = { [SUBSCRIPTION_META_KEY]: extra.requestId };
		let active!: Promise<void>;
		let stop!: () => void;
		const stopped = new Promise<void>((resolve) => { stop = resolve; });
		const subscriber: MailEventSubscriber = {
			stop,
			send: async (event) => {
				await active;
				await extra.sendNotification({
					method: 'notifications/events/event',
					params: { ...event, name: MAIL_EVENT_NAME, _meta: meta }
				});
			}
		};
		// Register before signalling readiness so the first receipt cannot race activation.
		subscribers.add(subscriber);
		extra.signal.addEventListener('abort', stop, { once: true });
		try {
			if (extra.signal.aborted) return {};
			active = extra.sendNotification({
				method: 'notifications/events/active',
				params: { status: 'active', _meta: meta }
			});
			await active;
			await stopped;
			if (!extra.signal.aborted) {
				await extra.sendNotification({
					method: 'notifications/events/terminated', params: { _meta: meta }
				});
			}
			return {};
		} finally {
			extra.signal.removeEventListener('abort', stop);
			subscribers.delete(subscriber);
		}
	});
	server.onclose = () => { for (const subscriber of subscribers) subscriber.stop(); };
	return server;
}

export async function authenticateMailEvents(db: D1Database, request: Request) {
	const token = readBearerToken(request);
	if (!token) return null;
	const auth = (await getUserByOAuthToken(db, token)) ?? (await getUserByApiToken(db, token));
	return auth?.scopes.includes('mail:read') ? { userId: auth.user.id, token } : null;
}

export type MailEventsEnv = {
	DB: D1Database;
	MAIL_EVENTS?: DurableObjectNamespace;
	waitUntil?: (task: Promise<void>) => void;
};

/** Best-effort push never turns a successfully received message into a failed delivery. */
export async function scheduleMailEvent(
	env: MailEventsEnv,
	input: { userId: string; emailId: string; providerId: string; source: 'resend' | 'cloudflare' }
): Promise<void> {
	if (!env.MAIL_EVENTS) return;
	const task = publishMailEvent(env, input).catch(() => {
		console.error('Failed to publish new-mail event', input.emailId);
	});
	if (env.waitUntil) env.waitUntil(task);
	else await task;
}

async function publishMailEvent(
	env: MailEventsEnv,
	input: { userId: string; emailId: string; providerId: string; source: 'resend' | 'cloudflare' }
): Promise<void> {
	const event: NewMailEvent = {
		eventId: await hashToken(`${input.source}\n${input.providerId}`),
		timestamp: new Date().toISOString(),
		data: {
			emailId: input.emailId,
			threadId: await getThreadKey(env.DB, input.emailId),
			source: input.source
		}
	};
	const broker = env.MAIL_EVENTS!.get(env.MAIL_EVENTS!.idFromName(input.userId));
	// Workers and DOM declare separate Fetch types for the same runtime API.
	const response = await (broker.fetch.bind(broker) as unknown as typeof fetch)('https://mail-events.internal/publish', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId: input.userId, event }),
		signal: AbortSignal.timeout(5_000)
	});
	if (!response.ok) throw new Error('Mail events broker unavailable');
}
