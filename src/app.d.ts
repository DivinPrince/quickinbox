import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Domain, MailAddress, User } from '$lib/types';

declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				ATTACHMENTS: R2Bucket;
				ASSETS: Fetcher;
				/** Resend API key — `wrangler secret put RESEND_API_KEY`. */
				RESEND_API_KEY: string;
				/** Signing secret from the Resend webhook (whsec_…). */
				RESEND_WEBHOOK_SECRET: string;
				/** Optional local demo domain when RESEND_API_KEY=demo_local. */
				DEMO_MAIL_DOMAIN?: string;
			};
		}
		interface Locals {
			user: User | null;
			/** Connected domains, loaded once per request for the switcher. */
			domains: Domain[];
			/** The signed-in user's sending identities. */
			addresses: MailAddress[];
			/** Active domain filter, or null for the combined inbox. */
			activeDomainId: string | null;
		}
	}
}

export {};
