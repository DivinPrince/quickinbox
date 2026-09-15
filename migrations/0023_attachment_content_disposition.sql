-- Forwarding needs the original MIME disposition so inline parts stay inline
-- and ordinary files stay attachments. content_id already exists from 0022.
ALTER TABLE email_attachments ADD COLUMN content_disposition TEXT;
