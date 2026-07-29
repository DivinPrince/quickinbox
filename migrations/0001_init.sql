CREATE TABLE users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE emails (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
	from_addr TEXT NOT NULL,
	to_addr TEXT NOT NULL,
	subject TEXT NOT NULL,
	body_text TEXT,
	body_html TEXT,
	message_id TEXT,
	in_reply_to TEXT,
	is_read INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_emails_user_created ON emails(user_id, created_at DESC);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
