import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_members import BRAIN_URL, SyncError, fetch_members, main, normalize_member, request, sync_members


def response(status=200, payload=None, headers=None):
    result = Mock(status_code=status, headers=headers or {})
    result.json.return_value = payload if payload is not None else {}
    return result


def board(rows, count=None, **extra):
    value = {"results": rows, **extra}
    if count is not None:
        value["count"] = count
    return response(payload=value)


class SyncTests(unittest.TestCase):
    def fetch(self, pages):
        session = Mock()
        session.request.side_effect = [response(201), *pages]
        return fetch_members(session, "private@example.com", "never-log-me", "2026-09-25", sleeper=lambda _: None), session

    def test_cookie_login_pagination_uses_actual_page_size_and_all_countries(self):
        members, session = self.fetch([
            board([{"user": "a1", "country": "US"}], 3),
            board([{"user": "b2", "country": "IN"}, {"user": "c3", "country": "CN"}], 3),
        ])
        self.assertEqual([m["country"] for m in members], ["US", "IN", "CN"])
        self.assertEqual(session.request.call_args_list[0].args, ("POST", BRAIN_URL + "/authentication"))
        self.assertEqual(session.request.call_args_list[0].kwargs["auth"], ("private@example.com", "never-log-me"))
        self.assertNotIn("auth", session.request.call_args_list[1].kwargs)
        self.assertEqual(session.request.call_args_list[2].kwargs["params"]["offset"], 1)
        self.assertFalse(session.request.call_args_list[0].kwargs["allow_redirects"])

    def test_missing_count_reads_through_short_pages_until_empty(self):
        members, session = self.fetch([board([{"user": "a1", "country": "SG"}]), board([])])
        self.assertEqual(len(members), 1)
        self.assertEqual(session.request.call_count, 3)

    def test_expired_session_reauthenticates_once(self):
        members, session = self.fetch([response(401), response(201), board([{"user": "a1", "country": "GB"}], 1)])
        self.assertEqual(len(members), 1)
        self.assertEqual([call.args[0] for call in session.request.call_args_list], ["POST", "GET", "POST", "GET"])

    def test_incomplete_changing_duplicate_empty_or_invalid_board_aborts(self):
        row = {"user": "a1", "country": "US"}
        cases = [
            [board([row], 2), board([], 2)],
            [board([row], 2), board([{"user": "b2", "country": "US"}], 3)],
            [board([row], 2), board([row], 2)],
            [board([])], [board([], 0)], [response(payload={"count": 3})],
            [board([{"user": "a1"}], 1)], [board([row], 2, next=None)],
            [board([row], 1.2)], [response(403)], [response(302)],
            [board([row]), board([], next="https://api.worldquantbrain.com/next")],
        ]
        for pages in cases:
            with self.subTest(pages=pages), self.assertRaises(SyncError):
                self.fetch(pages)

    def test_failed_login_does_not_fetch_board(self):
        session = Mock()
        session.request.return_value = response(401)
        with self.assertRaisesRegex(SyncError, "BRAIN login"):
            fetch_members(session, "private@example.com", "never-log-me", "2026-09-25")
        self.assertEqual(session.request.call_count, 1)

    def test_field_mapping_and_validation(self):
        self.assertEqual(normalize_member({"user": {"id": "a1", "country": " us "}}, "user.id", "user.country"), {"wqId": "A1", "country": "US"})
        for country in ["USA", "", None, "1A"]:
            with self.assertRaises(SyncError):
                normalize_member({"user": "a1", "country": country})

    def test_retry_after_transient_errors_and_network_failure(self):
        session, sleeper = Mock(), Mock()
        session.request.side_effect = [requests.Timeout("sensitive details"), response(429, headers={"Retry-After": "3"}), response()]
        request(session, "GET", BRAIN_URL, sleeper=sleeper)
        self.assertEqual([c.args[0] for c in sleeper.call_args_list], [1, 3])
        session.request.side_effect = None
        session.request.return_value = response(429, headers={"Retry-After": "1000"})
        with self.assertRaisesRegex(SyncError, "cooldown"):
            request(session, "GET", BRAIN_URL, sleeper=sleeper)

    def test_stage_all_rows_check_count_then_commit(self):
        session = Mock()
        import_id = "12345678-1234-1234-1234-123456789012"
        members = [{"wqId": f"ID{i}", "country": "US"} for i in range(101)]
        session.request.side_effect = [
            response(201, {"importId": import_id}), response(payload={"stagedRows": 100}),
            response(payload={"stagedRows": 101}), response(payload={"batch": {"total_rows": 101, "expected_rows": 101, "status": "staging"}}),
            response(payload={"committed": True, "importedRows": 101, "activeMembers": 110}),
        ]
        result = sync_members(session, "https://calendar.test", "secret-token", members, "2026-09-25")
        self.assertEqual(result["importedRows"], 101)
        self.assertTrue(session.request.call_args_list[-1].args[1].endswith("/commit"))
        self.assertEqual(len(session.request.call_args_list[2].kwargs["json"]["rows"]), 1)

    def test_stage_mismatch_never_commits(self):
        session = Mock()
        session.request.side_effect = [response(201, {"importId": "12345678-1234-1234-1234-123456789012"}), response(payload={"stagedRows": 0})]
        with self.assertRaisesRegex(SyncError, "mismatch"):
            sync_members(session, "https://calendar.test", "secret-token", [{"wqId": "A1", "country": "US"}], "2026-09-25")
        self.assertEqual(session.request.call_count, 2)

    @patch.dict("os.environ", {"WQ_USERNAME": "u", "WQ_PASSWORD": "p", "CALENDAR_API_URL": "https://calendar.test", "MEMBER_SYNC_TOKEN": "x" * 40}, clear=True)
    def test_fetch_failure_never_starts_calendar_import(self):
        with patch("sync_members.fetch_members", side_effect=SyncError("incomplete")), patch("sync_members.sync_members") as upload:
            with self.assertRaises(SyncError):
                main()
            upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
