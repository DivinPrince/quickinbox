-- OAuth 2.1 authorization server for the hosted MCP endpoint (/mcp).
--
-- MCP clients (Claude, Cursor, ChatGPT, …) register themselves, send the user
-- to /oauth/authorize, and exchange the resulting code for tokens. Everything
-- secret is stored as a SHA-256 hash, like sessions and API keys, so a database
-- read never yields a usable credential.

-- Registered clients (RFC 7591 dynamic registration, or a Client ID Metadata
-- Document fetched from an https client_id). Public clients only — no secrets.
CREATE TABLE oauth_clients (
	client_id     TEXT PRIMARY KEY,
	client_name   TEXT NOT NULL,
	client_uri    TEXT,
	logo_uri      TEXT,
	-- JSON array of exact redirect URIs.
	redirect_uris TEXT NOT NULL,
	created_at    TEXT NOT NULL,
	-- When the row was (re)fetched from a metadata document; NULL for registered clients.
	fetched_at    TEXT
);

-- Single-use authorization codes bound to the client, redirect URI and PKCE challenge.
CREATE TABLE oauth_codes (
	code_hash      TEXT PRIMARY KEY,
	client_id      TEXT NOT NULL,
	user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	redirect_uri   TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	scope          TEXT NOT NULL,
	resource       TEXT NOT NULL,
	expires_at     TEXT NOT NULL,
	created_at     TEXT NOT NULL
);

CREATE INDEX idx_oauth_codes_user ON oauth_codes(user_id);

-- One row per access/refresh token pair. Refreshing inserts a new row in the
-- same family and revokes the old one; presenting a revoked refresh token
-- again revokes the whole family (RFC 6819 replay detection).
CREATE TABLE oauth_grants (
	id                 TEXT PRIMARY KEY,
	family_id          TEXT NOT NULL,
	client_id          TEXT NOT NULL,
	user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	scope              TEXT NOT NULL,
	resource           TEXT NOT NULL,
	access_hash        TEXT NOT NULL,
	refresh_hash       TEXT NOT NULL,
	access_expires_at  TEXT NOT NULL,
	refresh_expires_at TEXT NOT NULL,
	created_at         TEXT NOT NULL,
	last_used_at       TEXT,
	revoked_at         TEXT
);

CREATE UNIQUE INDEX idx_oauth_grants_access ON oauth_grants(access_hash);
CREATE UNIQUE INDEX idx_oauth_grants_refresh ON oauth_grants(refresh_hash);
CREATE INDEX idx_oauth_grants_user ON oauth_grants(user_id);
CREATE INDEX idx_oauth_grants_family ON oauth_grants(family_id);
