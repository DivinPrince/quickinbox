-- Accounts created by an admin start with a temporary password. Require the
-- user to replace it before mailbox access; bootstrap owners remain complete.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
