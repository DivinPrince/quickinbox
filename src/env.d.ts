import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
	interface Env {
		DB: D1Database;
		ATTACHMENTS: R2Bucket;
		ASSETS: Fetcher;
		RESEND_API_KEY: string;
		RESEND_WEBHOOK_SECRET: string;
	}
}

export {};
