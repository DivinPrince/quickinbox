import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CloudflareSendEmailBinding } from '$lib/server/providers/cloudflare-provider';

declare global {
	interface Env {
		DB: D1Database;
		ATTACHMENTS: R2Bucket;
		ASSETS: Fetcher;
		EMAIL: CloudflareSendEmailBinding;
		EMAIL_PROVIDER?: string;
		DISABLE_PUBLIC_SETUP?: string;
		DISABLE_EXTERNAL_AUTH?: string;
		CLOUDFLARE_MAIL_DOMAINS?: string;
		RESEND_API_KEY: string;
		RESEND_WEBHOOK_SECRET: string;
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
		TELEGRAM_BOT_TOKEN?: string;
		TELEGRAM_CHAT_ID?: string;
		TELEGRAM_THREAD_ID?: string;
		APP_URL?: string;
		TYPESAFE_API_KEY?: string;
				/** AES-256-GCM key for authenticator secrets, stored as a Worker secret. */
				MFA_ENCRYPTION_KEY?: string;
	}
}

export {};
