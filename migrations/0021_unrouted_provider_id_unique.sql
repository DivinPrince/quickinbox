-- A provider that retries delivery sends the same message again. `emails` is
-- guarded by provider_id, but unrouted mail had no such guard, so a retry
-- duplicated the row and announced the message a second time.
DELETE FROM unrouted_emails
WHERE provider_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM unrouted_emails WHERE provider_id IS NOT NULL GROUP BY provider_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_unrouted_emails_provider_id
  ON unrouted_emails (provider_id)
  WHERE provider_id IS NOT NULL;
