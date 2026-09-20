-- Keep the original MIME for lossless re-export, separately from the display body.
ALTER TABLE emails ADD COLUMN raw_message_key TEXT;
ALTER TABLE emails ADD COLUMN raw_message_bytes INTEGER;
ALTER TABLE emails ADD COLUMN import_hash TEXT;
CREATE UNIQUE INDEX idx_emails_import_hash ON emails(user_id, import_hash)
WHERE import_hash IS NOT NULL;
