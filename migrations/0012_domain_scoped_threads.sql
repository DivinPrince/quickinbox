-- A conversation belongs to exactly one mailbox domain. Split any historical
-- cross-domain thread while preserving each domain's existing message chain.
CREATE TABLE _thread_domain_split (
	email_id TEXT PRIMARY KEY,
	new_thread_id TEXT NOT NULL
);

INSERT INTO _thread_domain_split (email_id, new_thread_id)
SELECT e.id,
	(
		SELECT root.id
		FROM emails root
		WHERE root.user_id = e.user_id
		  AND COALESCE(root.thread_id, root.id) = COALESCE(e.thread_id, e.id)
		  AND root.domain_id = e.domain_id
		ORDER BY datetime(root.created_at) ASC, root.id ASC
		LIMIT 1
	)
FROM emails e
WHERE e.domain_id IS NOT NULL
  AND EXISTS (
	SELECT 1
	FROM emails other
	WHERE other.user_id = e.user_id
	  AND COALESCE(other.thread_id, other.id) = COALESCE(e.thread_id, e.id)
	  AND other.domain_id IS NOT e.domain_id
  );

UPDATE emails
SET thread_id = (
	SELECT split.new_thread_id
	FROM _thread_domain_split split
	WHERE split.email_id = emails.id
)
WHERE id IN (SELECT email_id FROM _thread_domain_split);

DROP TABLE _thread_domain_split;

CREATE INDEX idx_emails_domain_thread_key
	ON emails(user_id, domain_id, thread_key);
CREATE INDEX idx_emails_domain_message_id
	ON emails(user_id, domain_id, message_id);
