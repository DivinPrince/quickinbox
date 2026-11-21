-- Attachment bytes for deployments without an R2 bucket (R2 needs a payment card).
-- D1 caps a row at 2 MB, so each object is split into chunks. `storage_key`
-- matches email_attachments.storage_key. Unused when R2 is bound.
CREATE TABLE IF NOT EXISTS attachment_chunks (
	storage_key TEXT NOT NULL,
	chunk_index INTEGER NOT NULL,
	data BLOB NOT NULL,
	PRIMARY KEY (storage_key, chunk_index)
);
