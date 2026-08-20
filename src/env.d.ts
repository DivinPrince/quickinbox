import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CloudflareSendEmailBinding } from '$lib/server/providers/cloudflare-provider';

declare global {
	interface Env {
		DB: D1Database;
		ATTACHMENTS: R2Bucket;
		ASSETS: Fetcher;
		EMAIL: CloudflareSendEmailBinding;
		EMAIL_PROVIDER?: string;
		CLOUDFLARE_MAIL_DOMAINS?: string;
		RESEND_API_KEY: string;
		RESEND_WEBHOOK_SECRET: string;
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
	}
}

export {};
