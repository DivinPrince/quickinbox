-- A send that carries an Idempotency-Key is recorded here before the provider
-- is called, so retrying the same request — a browser resubmit, an MCP client
-- that timed out — returns the original result instead of emailing twice.
--
-- `id` is a hash of the user id and the client's key: keys are scoped per user.
-- `request_hash` fingerprints the message, so reusing a key for different
-- content is refused rather than silently answered with the old result.
-- `email_id` has no foreign key on purpose: deleting a sent message forever
-- must not be blocked by, or cascade into, its send record.

CREATE TABLE send_attempts (
	id           TEXT PRIMARY KEY,
	user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	request_hash TEXT NOT NULL,
	status       TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
	email_id     TEXT,
	provider_id  TEXT,
	error        TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_send_attempts_user ON send_attempts(user_id, created_at);
