export {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS_PER_EMAIL,
	MAX_TOTAL_ATTACHMENT_BYTES
} from '$lib/constants';
export const SESSION_COOKIE = 'mail_session';
export const SESSION_DAYS = 7;
/** Bearer-token sessions (mobile) live longer; still revocable at any time. */
export const MOBILE_SESSION_DAYS = 90;
/** One-time pairing codes are valid for this long after creation. */
export const PAIRING_CODE_TTL_MINUTES = 5;
/** Max pair attempts per IP per fixed window. */
export const PAIR_RATE_LIMIT_MAX = 10;
export const PAIR_RATE_LIMIT_WINDOW_SECONDS = 300;
export const MAX_BODY_BYTES = 256_000;
export const UI_THEME_COOKIE = 'qi_ui_theme';
export const UI_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Cookie remembering which connected domain the dashboard is filtered to. */
export const DOMAIN_COOKIE = 'mail_domain';
