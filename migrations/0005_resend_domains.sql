-- Move from a single hardcoded Cloudflare Email domain to any number of
-- Resend domains reachable by the configured API key.

-- Domains the operator has connected from their Resend account.
-- `id` is the Resend domain id so we can re-sync status/capabilities.
CREATE TABLE domains (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE COLLATE NOCASE,
	status TEXT NOT NULL DEFAULT 'pending',
	region TEXT,
	sending_enabled INTEGER NOT NULL DEFAULT 0,
	receiving_enabled INTEGER NOT NULL DEFAULT 0,
	-- Resend receives mail for *every* address on a domain, so unmatched mail
	-- falls back to this user instead of being dropped.
	catchall_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	synced_at TEXT
);

-- A user's mail identities. Separate from users.email, which is only a login.
-- One user can hold addresses across several domains — that is what makes the
-- multi-domain dashboard work.
CREATE TABLE addresses (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
	address TEXT NOT NULL UNIQUE COLLATE NOCASE,
	label TEXT,
	is_default INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_addresses_user ON addresses(user_id);
CREATE INDEX idx_addresses_domain ON addresses(domain_id);

ALTER TABLE emails ADD COLUMN domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE emails ADD COLUMN provider_id TEXT;
ALTER TABLE emails ADD COLUMN status TEXT;
ALTER TABLE emails ADD COLUMN status_at TEXT;
ALTER TABLE emails ADD COLUMN status_detail TEXT;
ALTER TABLE emails ADD COLUMN cc_addr TEXT;
ALTER TABLE emails ADD COLUMN bcc_addr TEXT;

CREATE INDEX idx_emails_provider ON emails(provider_id);
CREATE INDEX idx_emails_domain ON emails(domain_id, created_at DESC);

-- Inbound mail that hit a connected domain but matched no address and had no
-- catch-all owner. Kept so nothing is silently lost; surfaced in Admin.
CREATE TABLE unrouted_emails (
	id TEXT PRIMARY KEY,
	provider_id TEXT,
	from_addr TEXT NOT NULL,
	to_addr TEXT NOT NULL,
	subject TEXT,
	reason TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Resend retries webhooks; this makes delivery idempotent.
CREATE TABLE webhook_events (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
