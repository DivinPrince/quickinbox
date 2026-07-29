import { createResendClient, type ResendClient } from './resend';

type PlatformLike = App.Platform | undefined | null;

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

/** Resend client for the configured API key, or a clear error if unset. */
export function getResendClient(platform: PlatformLike): ResendClient {
	const apiKey = platform?.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new ConfigError(
			'RESEND_API_KEY is not set. Add it with `wrangler secret put RESEND_API_KEY` (or to .dev.vars locally).'
		);
	}
	return createResendClient(apiKey);
}

export function getWebhookSecret(platform: PlatformLike): string | null {
	return platform?.env.RESEND_WEBHOOK_SECRET ?? null;
}

export function hasResendKey(platform: PlatformLike): boolean {
	return Boolean(platform?.env.RESEND_API_KEY);
}
