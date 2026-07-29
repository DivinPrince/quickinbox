CREATE TABLE email_attachments (
	id TEXT PRIMARY KEY,
	email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
	filename TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	content_base64 TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_email ON email_attachments(email_id);
