-- Where AI drafting runs. An admin may set one provider for everyone
-- (owner = 'instance': Workers AI or a shared key); any user may add their own
-- key (owner = their user id), which takes precedence for them.
--
-- `api_key` is AES-GCM ciphertext under the ENCRYPTION_KEY Worker secret, never
-- the key itself; `key_hint` keeps its last four characters so Settings can
-- show which key is saved.
CREATE TABLE ai_providers (
	owner      TEXT PRIMARY KEY,
	user_id    TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
	kind       TEXT NOT NULL CHECK (kind IN ('workers_ai', 'openai', 'anthropic')),
	base_url   TEXT,
	model      TEXT NOT NULL,
	api_key    TEXT,
	key_hint   TEXT,
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK ((owner = 'instance' AND user_id IS NULL) OR owner = user_id)
);
