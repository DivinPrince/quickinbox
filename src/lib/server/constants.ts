export {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS_PER_EMAIL,
	MAX_TOTAL_ATTACHMENT_BYTES
} from '$lib/constants';
export const SESSION_COOKIE = 'mail_session';
export const SESSION_DAYS = 7;
export const MAX_BODY_BYTES = 256_000;
/** Cookie remembering which connected domain the dashboard is filtered to. */
export const DOMAIN_COOKIE = 'mail_domain';
