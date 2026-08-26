export const APP_NAME = 'Quickinbox';
/**
 * Mail domains are discovered from the configured provider during onboarding
 * and stored in the `domains` table.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EMAIL = 5;
/** Providers cap a single message (including attachments) well above this. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Rows per page in the mailbox list. */
export const MAILBOX_PAGE_SIZE = 25;
