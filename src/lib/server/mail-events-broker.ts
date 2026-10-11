import type { D1Database, DurableObjectState } from '@cloudflare/workers-types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	authenticateMailEvents,
	createMailEventServer,
	NewMailEventSchema,
	type MailEventSubscriber
} from './mail-events';

type Session = {
	transport: WebStandardStreamableHTTPServerTransport;
	server: ReturnType<typeof createMailEventServer>;
	subscribers: Set<MailEventSubscriber>;
	userId: string;
	token: string;
	touched: number;
};

/** One broker per mailbox; provider callbacks and subscribers reach the same instance. */
export class MailEvents {
	private readonly sessions = new Map<string, Session>();
	constructor(private readonly state: DurableObjectState, private readonly env: { DB: D1Database }) {}

	async fetch(request: Request): Promise<Response> {
		if (new URL(request.url).hostname === 'mail-events.internal') return this.publish(request);
		const auth = await authenticateMailEvents(this.env.DB, request);
		if (!auth) return new Response('Mail read access required', { status: 401 });
		// Session state is in memory. An instance restart returns 404 so clients reinitialize.
		for (const [id, session] of this.sessions) {
			if (!session.subscribers.size && Date.now() - session.touched > 10 * 60_000) {
				await session.server.close();
				this.sessions.delete(id);
			}
		}
		const id = request.headers.get('mcp-session-id');
		let session = id ? this.sessions.get(id) : undefined;
		if (id && (!session || session.userId !== auth.userId || session.token !== auth.token)) {
			return new Response('Unknown event session; initialize again', { status: 404 });
		}
		if (!session) {
			if (request.method !== 'POST') return new Response('Initialize with POST', { status: 400 });
			if (this.sessions.size >= 32) return new Response('Too many event sessions', { status: 429 });
			const subscribers = new Set<MailEventSubscriber>();
			const server = createMailEventServer(subscribers);
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (id) => { this.sessions.set(id, session!); },
				onsessionclosed: async () => { await server.close(); }
			});
			session = { server, transport, subscribers, ...auth, touched: Date.now() };
			server.onclose = () => {
				for (const subscriber of subscribers) subscriber.stop();
				if (transport.sessionId) this.sessions.delete(transport.sessionId);
			};
			await server.connect(transport);
		}
		session.touched = Date.now();
		const response = await session.transport.handleRequest(request);
		if (!session.transport.sessionId) await session.server.close();
		// Transport cancellation alone drops its writer but does not abort the request handler.
		// Close this dedicated Events session when its HTTP stream disconnects.
		if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) return response;
		const reader = response.body.getReader();
		const current = session;
		return new Response(new ReadableStream({
			async pull(controller) {
				const chunk = await reader.read();
				if (chunk.done) controller.close();
				else controller.enqueue(chunk.value);
			},
			async cancel(reason) {
				await reader.cancel(reason);
				await current.server.close();
			}
		}), { status: response.status, headers: response.headers });
	}

	private async publish(request: Request): Promise<Response> {
		const body = await request.json() as { userId?: string; event?: unknown };
		const parsed = NewMailEventSchema.safeParse(body.event);
		if (!body.userId || !parsed.success) return new Response('Invalid event', { status: 400 });
		// An internal publisher cannot make this mailbox broadcast another user's message.
		const email = await this.env.DB.prepare('SELECT user_id, direction FROM emails WHERE id = ?')
			.bind(parsed.data.data.emailId).first<{ user_id: string; direction: string }>();
		if (!email || email.user_id !== body.userId || email.direction !== 'inbound') {
			return new Response('Unknown inbound message', { status: 400 });
		}
		// Bound retry deduplication to 256 receipts. This is a live stream, not an event journal.
		const fresh = await this.state.storage.transaction(async (storage) => {
			const recent = await storage.get<string[]>('recent') ?? [];
			if (recent.includes(parsed.data.eventId)) return false;
			await storage.put('recent', [...recent.slice(-255), parsed.data.eventId]);
			return true;
		});
		if (fresh) {
			for (const session of this.sessions.values()) {
				if (session.userId !== body.userId) continue;
				// Recheck before each receipt so expired/revoked tokens cannot keep receiving mail.
				const auth = await authenticateMailEvents(this.env.DB,
					new Request('https://mail-events.internal/auth', { headers: { Authorization: `Bearer ${session.token}` } }));
				if (!auth || auth.userId !== session.userId) {
					await session.server.close();
					continue;
				}
				for (const subscriber of session.subscribers) {
					try { await subscriber.send(parsed.data); }
					catch { subscriber.stop(); }
				}
			}
		}
		return new Response(null, { status: 204 });
	}
}
