-- Sends made with an API key or OAuth token (REST, CLI, MCP), counted per user
-- per UTC day against API_DAILY_SEND_LIMIT. Browser sends are not counted.
CREATE TABLE api_send_budget (
	user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	day        TEXT NOT NULL,
	send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
	PRIMARY KEY (user_id, day)
);
