-- Optional sign-off per sending address. NULL means use the account signature.
ALTER TABLE addresses ADD COLUMN signature TEXT;
