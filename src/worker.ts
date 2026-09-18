import { deploymentPolicyResponse } from './lib/server/deployment-policy';
import { getEmailProvider } from './lib/server/context';
import { flushOutbox } from './lib/server/durable-outbox';
import { recordOperationalFailure } from './lib/server/operational-events';
import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types';
import {
	handleCloudflareInbound,
	type CloudflareInboundEnv,
	type CloudflareInboundMessage
} from './lib/server/cloudflare-inbound';
// Renamed from `_worker.js` by `scripts/wrap-cloudflare-worker.mjs` after `vite build`.
// @ts-ignore generated worker and declaration are created at build time
import sveltekit from '../.svelte-kit/cloudflare/_sveltekit.js';

type SvelteKitWorker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
};

const svelteApp = sveltekit as SvelteKitWorker;

/**
 * SvelteKit's generated Worker is fetch-only. This wrapper keeps HTTP on
 * SvelteKit and adds Cloudflare Email Service's `email()` handler.
 */
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const pathname = new URL(request.url).pathname;
		const blocked = deploymentPolicyResponse(pathname, env);
		if (blocked) return blocked;
		if (typeof svelteApp.fetch !== 'function') {
			throw new Error('SvelteKit worker export is missing fetch');
		}
		return svelteApp.fetch(request, env, ctx);
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		await flushOutbox(env, getEmailProvider({ env, ctx }));
	},

	async email(message: CloudflareInboundMessage, env: Env, ctx: ExecutionContext) {
		if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== 'cloudflare') {
			message.setReject('Cloudflare email provider is not enabled');
			return;
		}

		const inboundEnv: CloudflareInboundEnv = {
			DB: env.DB,
			ATTACHMENTS: env.ATTACHMENTS,
			VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
			VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
			VAPID_SUBJECT: env.VAPID_SUBJECT,
			TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
			TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
			TELEGRAM_THREAD_ID: env.TELEGRAM_THREAD_ID,
			APP_URL: env.APP_URL,
			TYPESAFE_API_KEY: env.TYPESAFE_API_KEY,
			waitUntil: (promise) => ctx.waitUntil(promise)
		};

		try {
			await handleCloudflareInbound(message, inboundEnv);
		} catch (error) {
			await recordOperationalFailure(env.DB, 'inbound', 'Cloudflare inbound processing failed. Check Worker logs for details.');
			throw error;
		}
	}
};
