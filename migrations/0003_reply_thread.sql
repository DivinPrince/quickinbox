ALTER TABLE emails ADD COLUMN reply_to_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL;

CREATE INDEX idx_emails_reply_to ON emails(reply_to_email_id);
