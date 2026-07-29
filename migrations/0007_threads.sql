-- Conversations. Until now every message was an island: an inbound reply from
-- the other side landed in the inbox as if it were a brand new email. Each row
-- now carries the id of the conversation it belongs to.
--
-- `thread_key` is the subject with any Re:/Fwd: prefixes stripped. It backs the
-- fallback rule used when header threading can't work — Resend does not tell us
-- the Message-ID it stamped on our outbound mail, so a reply to something *we*
-- started references an id we never stored.
-- `references_header` keeps the inbound References chain, so a later reply can
-- be matched against any message in the conversation, not just its direct parent.

ALTER TABLE emails ADD COLUMN thread_id TEXT;
ALTER TABLE emails ADD COLUMN thread_key TEXT;
ALTER TABLE emails ADD COLUMN references_header TEXT;

CREATE INDEX idx_emails_thread ON emails(user_id, thread_id);
CREATE INDEX idx_emails_thread_key ON emails(user_id, thread_key);
CREATE INDEX idx_emails_message_id ON emails(user_id, message_id);

-- --- backfill -------------------------------------------------------------

-- Normalized subject. Kept in step with normalizeSubject() in
-- src/lib/server/threads.ts; three rounds covers "Re: Fwd: Re: ..." nesting.
UPDATE emails SET thread_key = lower(trim(subject));

UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 're:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 'fw:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 5)) WHERE thread_key LIKE 'fwd:%';

UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 're:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 'fw:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 5)) WHERE thread_key LIKE 'fwd:%';

UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 're:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 4)) WHERE thread_key LIKE 'fw:%';
UPDATE emails SET thread_key = ltrim(substr(thread_key, 5)) WHERE thread_key LIKE 'fwd:%';

-- Every message starts as its own conversation, then gets merged backwards.
UPDATE emails SET thread_id = id WHERE thread_id IS NULL;

-- Replies we sent from the message view already point at their parent.
-- Three passes propagate a chain of replies to the root.
UPDATE emails SET thread_id = (SELECT p.thread_id FROM emails p WHERE p.id = emails.reply_to_email_id)
WHERE reply_to_email_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM emails p WHERE p.id = emails.reply_to_email_id);

UPDATE emails SET thread_id = (SELECT p.thread_id FROM emails p WHERE p.id = emails.reply_to_email_id)
WHERE reply_to_email_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM emails p WHERE p.id = emails.reply_to_email_id);

UPDATE emails SET thread_id = (SELECT p.thread_id FROM emails p WHERE p.id = emails.reply_to_email_id)
WHERE reply_to_email_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM emails p WHERE p.id = emails.reply_to_email_id);

-- Inbound mail that answers a message whose Message-ID we stored.
UPDATE emails SET thread_id = (
	SELECT p.thread_id FROM emails p
	WHERE p.user_id = emails.user_id
	  AND p.message_id IS NOT NULL
	  AND replace(replace(p.message_id, '<', ''), '>', '') =
	      replace(replace(emails.in_reply_to, '<', ''), '>', '')
	ORDER BY datetime(p.created_at) ASC LIMIT 1
)
WHERE in_reply_to IS NOT NULL AND EXISTS (
	SELECT 1 FROM emails p
	WHERE p.user_id = emails.user_id
	  AND p.message_id IS NOT NULL
	  AND replace(replace(p.message_id, '<', ''), '>', '') =
	      replace(replace(emails.in_reply_to, '<', ''), '>', '')
);

UPDATE emails SET thread_id = (
	SELECT p.thread_id FROM emails p
	WHERE p.user_id = emails.user_id
	  AND p.message_id IS NOT NULL
	  AND replace(replace(p.message_id, '<', ''), '>', '') =
	      replace(replace(emails.in_reply_to, '<', ''), '>', '')
	ORDER BY datetime(p.created_at) ASC LIMIT 1
)
WHERE in_reply_to IS NOT NULL AND EXISTS (
	SELECT 1 FROM emails p
	WHERE p.user_id = emails.user_id
	  AND p.message_id IS NOT NULL
	  AND replace(replace(p.message_id, '<', ''), '>', '') =
	      replace(replace(emails.in_reply_to, '<', ''), '>', '')
);

-- Finally the subject rule, which is what rescues the common case: we sent
-- something, they replied, and their "Re:" references a Message-ID Resend never
-- handed back to us. Adopts the oldest message with the same normalized subject
-- that shares a participant. Two passes so chains settle on one root.
UPDATE emails SET thread_id = COALESCE((
	SELECT o.thread_id FROM emails o
	WHERE o.user_id = emails.user_id
	  AND o.thread_key = emails.thread_key
	  AND o.thread_key <> ''
	  AND o.thread_key <> '(no subject)'
	  AND (o.status IS NULL OR o.status <> 'draft')
	  AND abs(julianday(o.created_at) - julianday(emails.created_at)) <= 180
	  AND (
	      instr(lower(o.from_addr || ' ' || o.to_addr || ' ' || COALESCE(o.cc_addr, '')),
	            lower(emails.from_addr)) > 0
	   OR instr(lower(emails.from_addr || ' ' || emails.to_addr || ' ' || COALESCE(emails.cc_addr, '')),
	            lower(o.from_addr)) > 0
	  )
	ORDER BY datetime(o.created_at) ASC, o.id ASC LIMIT 1
), thread_id)
WHERE status IS NULL OR status <> 'draft';

UPDATE emails SET thread_id = COALESCE((
	SELECT o.thread_id FROM emails o
	WHERE o.user_id = emails.user_id
	  AND o.thread_key = emails.thread_key
	  AND o.thread_key <> ''
	  AND o.thread_key <> '(no subject)'
	  AND (o.status IS NULL OR o.status <> 'draft')
	  AND abs(julianday(o.created_at) - julianday(emails.created_at)) <= 180
	  AND (
	      instr(lower(o.from_addr || ' ' || o.to_addr || ' ' || COALESCE(o.cc_addr, '')),
	            lower(emails.from_addr)) > 0
	   OR instr(lower(emails.from_addr || ' ' || emails.to_addr || ' ' || COALESCE(emails.cc_addr, '')),
	            lower(o.from_addr)) > 0
	  )
	ORDER BY datetime(o.created_at) ASC, o.id ASC LIMIT 1
), thread_id)
WHERE status IS NULL OR status <> 'draft';
