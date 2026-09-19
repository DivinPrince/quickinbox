ALTER TABLE emails ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN draft_save_id TEXT;
ALTER TABLE emails ADD COLUMN draft_payload_key TEXT;
ALTER TABLE emails ADD COLUMN draft_payload_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN draft_attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN snoozed_until TEXT;
ALTER TABLE emails ADD COLUMN cleanup_revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_emails_snoozed ON emails(snoozed_until) WHERE snoozed_until IS NOT NULL;

CREATE VIRTUAL TABLE email_search USING fts5(subject, from_addr, to_addr, cc_addr, body_text, content='emails', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
INSERT INTO email_search(email_search) VALUES('rebuild');
CREATE TRIGGER email_search_insert AFTER INSERT ON emails BEGIN
  INSERT INTO email_search(rowid, subject, from_addr, to_addr, cc_addr, body_text) VALUES(new.rowid, new.subject, new.from_addr, new.to_addr, new.cc_addr, new.body_text);
END;
CREATE TRIGGER email_search_delete AFTER DELETE ON emails BEGIN
  INSERT INTO email_search(email_search, rowid, subject, from_addr, to_addr, cc_addr, body_text) VALUES('delete', old.rowid, old.subject, old.from_addr, old.to_addr, old.cc_addr, old.body_text);
END;
CREATE TRIGGER email_search_update AFTER UPDATE OF subject, from_addr, to_addr, cc_addr, body_text ON emails BEGIN
  INSERT INTO email_search(email_search, rowid, subject, from_addr, to_addr, cc_addr, body_text) VALUES('delete', old.rowid, old.subject, old.from_addr, old.to_addr, old.cc_addr, old.body_text);
  INSERT INTO email_search(rowid, subject, from_addr, to_addr, cc_addr, body_text) VALUES(new.rowid, new.subject, new.from_addr, new.to_addr, new.cc_addr, new.body_text);
END;

CREATE TABLE mail_action_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mail_action_items (
  action_id TEXT NOT NULL REFERENCES mail_action_history(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  previous_value TEXT,
  previous_archived TEXT,
  revision INTEGER NOT NULL,
  PRIMARY KEY(action_id, email_id)
);
CREATE TABLE sender_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL COLLATE NOCASE,
  subject_contains TEXT NOT NULL DEFAULT '',
  label_id TEXT REFERENCES labels(id) ON DELETE SET NULL,
  archive INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sender_rules_user_sender ON sender_rules(user_id, sender);

-- Exact sender rules run with the inbound insert, so a retried webhook cannot skip them.
CREATE TRIGGER sender_rules_inbound AFTER INSERT ON emails WHEN new.direction = 'inbound' BEGIN
  INSERT OR IGNORE INTO email_labels (email_id, label_id, source)
    SELECT new.id, r.label_id, 'user' FROM sender_rules r JOIN labels l ON l.id = r.label_id AND l.user_id = new.user_id
    WHERE r.user_id = new.user_id AND r.enabled = 1
      AND r.sender = lower(trim(CASE WHEN instr(new.from_addr, '<') > 0 THEN substr(new.from_addr, instr(new.from_addr, '<') + 1, instr(new.from_addr, '>') - instr(new.from_addr, '<') - 1) ELSE new.from_addr END))
      AND (r.subject_contains = '' OR instr(lower(new.subject), lower(r.subject_contains)) > 0);
  UPDATE emails SET archived_at = datetime('now'), snoozed_until = NULL, cleanup_revision = cleanup_revision + 1
    WHERE user_id = new.user_id AND COALESCE(thread_id, id) = COALESCE(new.thread_id, new.id)
      AND EXISTS (SELECT 1 FROM sender_rules r WHERE r.user_id = new.user_id AND r.enabled = 1 AND r.archive = 1
        AND r.sender = lower(trim(CASE WHEN instr(new.from_addr, '<') > 0 THEN substr(new.from_addr, instr(new.from_addr, '<') + 1, instr(new.from_addr, '>') - instr(new.from_addr, '<') - 1) ELSE new.from_addr END))
        AND (r.subject_contains = '' OR instr(lower(new.subject), lower(r.subject_contains)) > 0));
END;
