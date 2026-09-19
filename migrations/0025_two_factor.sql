-- Browser two-factor authentication. Secrets are AES-GCM ciphertext, never plaintext.
CREATE TABLE user_mfa (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL,
 generation TEXT NOT NULL UNIQUE,
 last_used_step INTEGER NOT NULL DEFAULT -1,
 last_verification TEXT,
 enabled_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE mfa_enrollments (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 secret_encrypted TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE mfa_recovery_codes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 generation TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 PRIMARY KEY (user_id, code_hash)
);
ALTER TABLE sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0;
-- Fail closed even if an older Worker or an alternate session issuer is used.
CREATE TRIGGER require_mfa_session BEFORE INSERT ON sessions
WHEN NEW.mfa_verified <> 1 AND EXISTS (SELECT 1 FROM user_mfa WHERE user_id = NEW.user_id)
BEGIN
 SELECT RAISE(ABORT, 'Two-factor verification required');
END;
