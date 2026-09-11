-- Inline images reference a MIME part by its Content-ID (`<img src="cid:…">`).
-- Without the Content-ID stored alongside the file there is nothing to match
-- that reference against, so every inline image rendered broken.
ALTER TABLE email_attachments ADD COLUMN content_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_attachments_content_id
	ON email_attachments (email_id, content_id);
