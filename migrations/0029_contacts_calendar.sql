CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX contacts_owner_name ON contacts(user_id, name COLLATE NOCASE, id);
CREATE TABLE contact_emails (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, email)
);
CREATE INDEX contact_emails_contact ON contact_emails(contact_id, position);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  organizer_email TEXT NOT NULL,
  data_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, uid)
);
CREATE INDEX calendar_events_range ON calendar_events(user_id, starts_at, ends_at);

-- Immutable notices are handed to the existing durable outbox. Retries reuse
-- the notice id, including after a worker restart between enqueue and receipt.
CREATE TABLE calendar_notices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  event_version INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','queued','failed')),
  email_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX calendar_notices_due ON calendar_notices(state, next_attempt_at, lease_until);

CREATE TABLE calendar_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  event_version INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  notified_at TEXT,
  dismissed_at TEXT,
  UNIQUE(event_id, event_version)
);
CREATE INDEX calendar_reminders_due ON calendar_reminders(due_at, notified_at);
CREATE INDEX calendar_reminders_owner ON calendar_reminders(user_id, dismissed_at, notified_at);
