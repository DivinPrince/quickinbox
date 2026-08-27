-- A short, plain-text sign-off appended to new messages and replies.
ALTER TABLE users ADD COLUMN email_signature TEXT NOT NULL DEFAULT '';
