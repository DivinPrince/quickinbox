-- Shareable UI theme preference (Zero / Classic / drop-in themes).
ALTER TABLE users ADD COLUMN ui_theme TEXT NOT NULL DEFAULT 'zero';
