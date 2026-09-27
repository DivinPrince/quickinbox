-- Standing instructions for "Draft reply", set by each user under
-- Settings › AI drafting: tone, who they are, what to never promise.
ALTER TABLE users ADD COLUMN ai_instructions TEXT;
