-- Profile pictures.
--
-- Two separate concerns share one feature:
--
-- 1. A user's own picture, uploaded in Settings. The bytes live in R2 under
--    `avatar_key`; only the key is stored here.
-- 2. Pictures for people we exchange mail with. Those cannot be uploaded by us,
--    so they are looked up from public sources -- Gravatar for individuals, BIMI
--    (the logo a domain publishes in DNS) for brands -- and cached below so a
--    busy mailbox does not refetch the same face on every render.
--
-- `contact_avatars` caches misses too: `source = 'none'` with a null key means
-- "we looked and there is nothing", which is the common case and the one most
-- worth not repeating. Rows are refreshed once they age past the TTL in
-- avatars.ts.

ALTER TABLE users ADD COLUMN avatar_key TEXT;

-- Off switch for the outbound lookups above. Server-side only -- the browser
-- never talks to Gravatar directly -- but some operators still will not want
-- their Worker resolving correspondents against a third party at all.
ALTER TABLE users ADD COLUMN external_avatars INTEGER NOT NULL DEFAULT 1;

CREATE TABLE contact_avatars (
	email        TEXT PRIMARY KEY COLLATE NOCASE,
	source       TEXT NOT NULL CHECK (source IN ('gravatar', 'bimi', 'none')),
	storage_key  TEXT,
	content_type TEXT,
	fetched_at   TEXT NOT NULL
);

CREATE INDEX idx_contact_avatars_fetched ON contact_avatars(fetched_at);
