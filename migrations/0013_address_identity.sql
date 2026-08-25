-- Record which registered address received a message, not just its domain, so
-- the combined inbox can say — and filter by — the identity mail arrived on.
ALTER TABLE emails ADD COLUMN address_id TEXT REFERENCES addresses(id) ON DELETE SET NULL;
CREATE INDEX idx_emails_address ON emails(address_id, created_at DESC);

-- Inbound rows store the routed mailbox in to_addr, so existing mail can be
-- claimed by an exact match. Catch-all deliveries stay NULL on purpose.
UPDATE emails
SET address_id = (
	SELECT a.id FROM addresses a
	WHERE a.address = emails.to_addr COLLATE NOCASE
	  AND a.user_id = emails.user_id
)
WHERE direction = 'inbound' AND address_id IS NULL;

-- Outbound and drafts store the sending mailbox in from_addr.
UPDATE emails
SET address_id = (
	SELECT a.id FROM addresses a
	WHERE a.address = emails.from_addr COLLATE NOCASE
	  AND a.user_id = emails.user_id
)
WHERE direction = 'outbound' AND address_id IS NULL;
