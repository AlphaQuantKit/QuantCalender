-- NULL denotes the initial/reset WQ_ID password. Verify using the existing
-- keyed WQ_ID index; never store the initial password in plaintext.
ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN password_changed_at INTEGER;
-- Old Worker instances omit this column when creating passwordless sessions.
-- A negative sentinel also rejects those sessions created during deployment.
ALTER TABLE sessions ADD COLUMN password_version INTEGER NOT NULL DEFAULT -1;

-- Sessions created by the previous passwordless login must authenticate again.
-- Admin sessions, calendar subscriptions and contributions are left untouched.
DELETE FROM sessions WHERE role = 'member';
