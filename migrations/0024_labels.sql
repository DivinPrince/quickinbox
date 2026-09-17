-- Inbox categories, spam mailbox, custom labels, and sender spam/ham memory.
-- Category is exclusive (Gmail-style tabs). Spam is a mailbox flag, not a tab.

ALTER TABLE emails ADD COLUMN category TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE emails ADD COLUMN category_source TEXT;
ALTER TABLE emails ADD COLUMN spam_at TEXT;
ALTER TABLE emails ADD COLUMN spam_source TEXT;
ALTER TABLE emails ADD COLUMN updated_at TEXT;

UPDATE emails SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX idx_emails_spam ON emails(user_id, spam_at);
CREATE INDEX idx_emails_category ON emails(user_id, category, spam_at);

-- Bumped when category, spam, or labels change so live sync notices in-place edits.
ALTER TABLE users ADD COLUMN mailbox_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE labels (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	slug TEXT NOT NULL,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '#64748b',
	auto_enabled INTEGER NOT NULL DEFAULT 0,
	auto_instructions TEXT,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (user_id, slug)
);

CREATE TABLE email_labels (
	email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
	label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
	source TEXT NOT NULL CHECK (source IN ('auto', 'user')),
	score REAL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (email_id, label_id)
);

CREATE INDEX idx_email_labels_label ON email_labels(label_id);

CREATE TABLE sender_prefs (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	from_addr TEXT NOT NULL COLLATE NOCASE,
	disposition TEXT NOT NULL CHECK (disposition IN ('spam', 'safe')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, from_addr)
);
