-- Browser Web Push subscriptions. One user can enable notifications on
-- several browsers/devices; deleting the user removes every subscription.

CREATE TABLE push_subscriptions (
	id              TEXT PRIMARY KEY,
	user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint        TEXT NOT NULL UNIQUE,
	p256dh           TEXT NOT NULL,
	auth             TEXT NOT NULL,
	expiration_time  INTEGER,
	user_agent       TEXT,
	created_at       TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
