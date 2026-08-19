-- API tokens: long-lived bearer credentials that let automation (scripts, CI,
-- cron jobs) hit the mail API -- POST /api/mail to send, GET /api/mail to list --
-- without a browser session cookie.
--
-- Only the SHA-256 hash of a token is stored (reusing the same derivation the
-- session uses). The raw value is shown exactly once, at creation time, so it is
-- gone forever if the operator loses it -- create a new one instead.
-- `token_preview` keeps a masked fragment (first 8 + last 4 chars) purely so the
-- list UI can tell two tokens apart. It is not secret enough to authenticate.
-- `scopes` currently gates nothing beyond the request happening as the owning
-- user, but is kept so future stricter per-scope authorization can be added.

CREATE TABLE api_tokens (
	id            TEXT PRIMARY KEY,
	user_id       TEXT NOT NULL,
	name          TEXT NOT NULL,
	token_hash    TEXT NOT NULL,
	token_preview TEXT NOT NULL,
	scopes        TEXT NOT NULL DEFAULT 'mail:send',
	created_at    TEXT NOT NULL,
	last_used_at  TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);