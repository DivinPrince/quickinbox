-- Mobile app pairing: one-time codes scanned as QR from the web, exchanged for
-- a long-lived bearer token. Device metadata rides on sessions so revocation
-- stays the existing "delete a session row" operation.

ALTER TABLE sessions ADD COLUMN device_name TEXT;
ALTER TABLE sessions ADD COLUMN device_platform TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at DESC);

CREATE TABLE pairing_codes (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	code_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pairing_codes_expiry ON pairing_codes(expires_at);

-- Fixed-window counters for the unauthenticated pair endpoint. Key is e.g.
-- 'pair:<ip>'; window_start is a unix epoch second.
CREATE TABLE rate_limits (
	key TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 0,
	window_start INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
