-- Threads are grouped by COALESCE(thread_id, id). Without an index on that
-- expression, every join on it rescans all of a user's mail per thread, so
-- listing the mailbox reads rows quadratically in the size of the inbox.
CREATE INDEX idx_emails_user_conversation ON emails(user_id, COALESCE(thread_id, id));
