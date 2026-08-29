-- UI language preference (en / fr / zh-CN / es).
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
