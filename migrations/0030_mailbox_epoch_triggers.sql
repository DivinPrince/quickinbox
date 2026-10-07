-- The live-sync cursor used to COUNT(*) a user's whole mailbox once a second
-- per open tab, so polling cost grew with the inbox. Bumping the epoch on every
-- insert and delete lets the cursor read a single users row instead. Triggers
-- cover every write path (inbound, send, drafts, purge) without each caller
-- having to remember to bump.
CREATE TRIGGER emails_bump_epoch_on_insert AFTER INSERT ON emails
BEGIN
	UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER emails_bump_epoch_on_delete AFTER DELETE ON emails
BEGIN
	UPDATE users SET mailbox_epoch = mailbox_epoch + 1 WHERE id = OLD.user_id;
END;
