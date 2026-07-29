export const APP_NAME = 'Mail';
/**
 * Mail domains are no longer hardcoded — they are discovered from the Resend
 * account during onboarding and stored in the `domains` table.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EMAIL = 5;
/** Resend caps a single message (including attachments) at 40MB. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Rows per page in the mailbox list. */
export const MAILBOX_PAGE_SIZE = 25;
