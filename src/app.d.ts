import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CloudflareSendEmailBinding } from '$lib/server/providers/cloudflare-provider';
import type { ApiScope } from '$lib/server/api-tokens';
import type { Domain, MailAddress, User } from '$lib/types';

declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				ATTACHMENTS: R2Bucket;
				ASSETS: Fetcher;
				EMAIL: CloudflareSendEmailBinding;
				/** `resend` (default) or `cloudflare`. */
				EMAIL_PROVIDER?: string;
				/** Comma-separated domains when EMAIL_PROVIDER=cloudflare. */
				CLOUDFLARE_MAIL_DOMAINS?: string;
				/** Resend API key — `wrangler secret put RESEND_API_KEY`. */
				RESEND_API_KEY: string;
				/** Signing secret from the Resend webhook (whsec_…). */
				RESEND_WEBHOOK_SECRET: string;
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
			/**
			 * Set only when the request authenticated with an API key, so handlers
			 * can authorize without a second lookup. Null means a browser session,
			 * which is not scope-limited.
			 */
			apiToken: { id: string; scopes: ApiScope[] } | null;
		}
	}
}

export {};
