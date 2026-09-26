-- D1 keeps foreign_keys ON: DROP TABLE still executes CASCADE / SET NULL.
-- Snapshot ALL member references before rebuilding, and restore them in this
-- migration's transaction. Do not replace this with foreign_keys=OFF.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _global_sessions AS SELECT * FROM sessions;
CREATE TABLE _global_activity AS SELECT * FROM member_activity;
CREATE TABLE _global_tokens AS SELECT * FROM calendar_tokens;
CREATE TABLE _global_reports AS SELECT * FROM replay_reports;
CREATE TABLE _global_events AS SELECT id, submitter_member_id FROM events;
CREATE TABLE _global_replays AS SELECT id, submitter_member_id FROM replay_links;
CREATE TABLE _global_items AS SELECT id, submitter_member_id FROM important_items;

CREATE TABLE members_global (
  id TEXT PRIMARY KEY,
  wq_id_hash TEXT NOT NULL UNIQUE,
  wq_id_hint TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2 AND country NOT GLOB '*[^A-Z]*'),
  record_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  import_batch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  wq_id_ciphertext TEXT,
  public_wq_id INTEGER NOT NULL DEFAULT 1 CHECK (public_wq_id IN (0, 1))
);
INSERT INTO members_global SELECT * FROM members;
DROP TABLE members;
ALTER TABLE members_global RENAME TO members;

-- Admin sessions survive the cascade; member sessions are restored by ID.
INSERT OR IGNORE INTO sessions SELECT * FROM _global_sessions;
INSERT INTO member_activity SELECT * FROM _global_activity;
INSERT INTO calendar_tokens SELECT * FROM _global_tokens;
INSERT INTO replay_reports SELECT * FROM _global_reports;
UPDATE events SET submitter_member_id = (SELECT submitter_member_id FROM _global_events WHERE _global_events.id = events.id);
UPDATE replay_links SET submitter_member_id = (SELECT submitter_member_id FROM _global_replays WHERE _global_replays.id = replay_links.id);
UPDATE important_items SET submitter_member_id = (SELECT submitter_member_id FROM _global_items WHERE _global_items.id = important_items.id);

DROP TABLE _global_sessions;
DROP TABLE _global_activity;
DROP TABLE _global_tokens;
DROP TABLE _global_reports;
DROP TABLE _global_events;
DROP TABLE _global_replays;
DROP TABLE _global_items;

CREATE TABLE member_import_rows_global (
  import_id TEXT NOT NULL REFERENCES member_imports(id) ON DELETE CASCADE,
  wq_id_hash TEXT NOT NULL,
  wq_id_hint TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2 AND country NOT GLOB '*[^A-Z]*'),
  record_date TEXT NOT NULL,
  wq_id_ciphertext TEXT,
  PRIMARY KEY (import_id, wq_id_hash)
);
INSERT INTO member_import_rows_global SELECT * FROM member_import_rows;
DROP TABLE member_import_rows;
ALTER TABLE member_import_rows_global RENAME TO member_import_rows;

ALTER TABLE member_imports ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'platform'));
ALTER TABLE member_imports ADD COLUMN expected_rows INTEGER;
ALTER TABLE member_imports ADD COLUMN board_date TEXT;

PRAGMA defer_foreign_keys = OFF;
