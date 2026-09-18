CREATE TABLE outbox_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'cloudflare')),
  state TEXT NOT NULL CHECK (state IN ('preparing', 'pending', 'sending', 'retry', 'accepted', 'failed', 'uncertain')),
  email_id TEXT REFERENCES emails(id) ON DELETE CASCADE,
  payload_key TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  prepared INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, request_key)
);
CREATE INDEX idx_outbox_due ON outbox_jobs(state, next_attempt_at);
CREATE INDEX idx_outbox_user ON outbox_jobs(user_id, created_at DESC);

CREATE TABLE trusted_image_senders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, sender)
);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('inbound', 'outbound', 'system')),
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_operational_events_created ON operational_events(created_at DESC);
CREATE TABLE maintenance_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Webhooks can arrive before a send response provides the provider id.
CREATE TABLE outbound_delivery_events (
  provider_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
