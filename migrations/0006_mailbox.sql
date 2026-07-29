-- Mailbox features the list view needs: starring, a trash that can be undone,
-- and drafts (outbound rows that were never handed to Resend, status='draft').

ALTER TABLE emails ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_emails_starred ON emails(user_id, is_starred);
CREATE INDEX idx_emails_deleted ON emails(user_id, deleted_at);
