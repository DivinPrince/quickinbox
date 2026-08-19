-- Long-lived bearer tokens for the CLI and MCP server. Only the SHA-256 hash
-- is stored (same derivation as sessions). The raw value is shown once at
-- create time. `token_preview` is a non-secret fragment so the Settings list
-- can tell keys apart.

CREATE TABLE api_tokens (
	id            TEXT PRIMARY KEY,
	user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name          TEXT NOT NULL,
	token_hash    TEXT NOT NULL,
	token_preview TEXT NOT NULL,
	scopes        TEXT NOT NULL DEFAULT 'mail:read,mail:send',
	created_at    TEXT NOT NULL,
	last_used_at  TEXT
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE UNIQUE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
