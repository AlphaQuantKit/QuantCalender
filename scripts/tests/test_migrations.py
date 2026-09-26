"""Verify upgrades with foreign_keys ON (including D1 cascade semantics)."""
import sqlite3
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "worker" / "migrations"


class MigrationTests(unittest.TestCase):
    def test_upgrade_preserves_all_existing_data_and_relationships(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("PRAGMA foreign_keys=ON")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name.startswith("0009_"):
                break
            db.executescript(path.read_text(encoding="utf-8"))
        db.executescript("""
            INSERT INTO members VALUES ('m', 'hash', 'hint', 'HK', '2026-09-25', 1, 'import', 1, 2, 'encrypted', 0);
            INSERT INTO sessions VALUES ('s', 'token', 'csrf', 'm', 'member', 9, 1, 2);
            INSERT INTO sessions VALUES ('a', 'admin-token', 'admin-csrf', NULL, 'admin', 9, 1, 2);
            INSERT INTO member_activity VALUES ('m', 1, 2, 3, 4);
            INSERT INTO calendar_tokens VALUES ('c', 'm', 'calendar-token', 0, 1, 2, NULL, 1, 0, 1, 0);
            INSERT INTO events (id, uid, status, submitter_member_id, title, category, meeting_language,
              registration_url, start_beijing, duration_minutes, created_by, created_at, updated_at)
              VALUES ('e', 'e-uid', 'published', 'm', 'title', 'meeting', 'en', 'https://example.com', '2026-09-25T12:00:00', 30, 'm', 1, 2);
            INSERT INTO replay_groups VALUES ('g', 'e', '2026-09-25', 'replay', '2026-09-25', 1, 2);
            INSERT INTO replay_links (id, group_id, provider, share_url, url_hash, submitter_member_id, status, created_by, created_at, updated_at)
              VALUES ('r', 'g', 'other', 'https://example.com', 'url-hash', 'm', 'published', 'm', 1, 2);
            INSERT INTO replay_reports (id, replay_link_id, reporter_member_id, link_version, reason, created_at)
              VALUES ('report', 'r', 'm', 1, 'other', 1);
            INSERT INTO important_items (id, uid, status, kind, submitter_member_id, title, start_date, end_date, created_by, created_at, updated_at)
              VALUES ('i', 'i-uid', 'published', 'ppa', 'm', 'topic', '2026-09-25', '2026-09-26', 'm', 1, 2);
            INSERT INTO member_imports VALUES ('batch', 'staging', 1, 1, NULL);
            INSERT INTO member_import_rows VALUES ('batch', 'hash', 'hint', 'HK', '2026-09-25', 'encrypted');
        """)
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before = {table: db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall() for table in tables}
        # Like D1 migrations, execute all statements inside a transaction with FKs ON.
        db.executescript("BEGIN;\n" + (MIGRATIONS / "0009_global_members.sql").read_text(encoding="utf-8") + "\nCOMMIT;")
        for table in tables:
            after = db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()
            if table == "member_imports":
                after = [row[:5] for row in after]
            self.assertEqual(after, before[table], table)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        db.execute("UPDATE members SET country='US'")
        db.execute("UPDATE member_import_rows SET country='IN'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE members SET country='USA'")
        self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE name LIKE '_global_%'").fetchall(), [])

        # Password upgrade only revokes legacy passwordless member sessions.
        # It must not reset imported metadata, admin sessions or private feeds.
        db.commit()
        db.executescript("BEGIN;\n" + (MIGRATIONS / "0010_member_passwords.sql").read_text(encoding="utf-8") + "\nCOMMIT;")
        self.assertEqual(db.execute("SELECT id FROM sessions").fetchall(), [('a',)])
        self.assertEqual(db.execute("SELECT password_hash, password_version FROM members").fetchall(), [(None, 0)])
        for table in ['calendar_tokens', 'member_activity', 'events', 'replay_links', 'replay_reports', 'important_items']:
            self.assertEqual(db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall(), before[table], table)
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
