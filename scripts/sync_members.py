"""Fetch a complete BRAIN board with a cookie session, then stage/commit members.

Credentials stay in environment variables and memory; never print response bodies,
cookies, member IDs or request exception details (which may contain credentials).
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

import requests

BRAIN_URL = "https://api.worldquantbrain.com"
BOARD_PATH = "/consultant/boards/genius"
MAX_MEMBERS = 100000
RETRY_STATUSES = {429, 500, 502, 503, 504}


class SyncError(Exception):
    """A sanitized error safe to show in Actions logs."""


def request(session, method, url, *, sleeper=time.sleep, **kwargs):
    for attempt in range(5):
        try:
            response = session.request(method, url, timeout=(15, 60), allow_redirects=False, **kwargs)
        except requests.RequestException:
            if attempt == 4:
                raise SyncError("Network request failed after retries") from None
            sleeper(min(2**attempt, 30))
            continue
        if response.status_code not in RETRY_STATUSES or attempt == 4:
            return response
        delay = float(min(2**attempt, 30))
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                delay = float(retry_after)
            except ValueError:
                try:
                    delay = parsedate_to_datetime(retry_after).timestamp() - time.time()
                except (ValueError, TypeError, OverflowError):
                    pass
        if not 0 <= delay <= 120:
            raise SyncError("Server requested a long cooldown; retry the workflow later")
        sleeper(delay)
    raise SyncError("Request retries exhausted")


def json_object(response, operation):
    if not 200 <= response.status_code < 300:
        raise SyncError(f"{operation}: HTTP {response.status_code}")
    try:
        value = response.json()
    except ValueError:
        raise SyncError(f"{operation}: invalid JSON") from None
    if not isinstance(value, dict):
        raise SyncError(f"{operation}: expected a JSON object")
    return value


def login(session, username, password, *, sleeper=time.sleep):
    response = request(session, "POST", BRAIN_URL + "/authentication", auth=(username, password), sleeper=sleeper)
    if response.status_code != 201:
        raise SyncError(f"BRAIN login: HTTP {response.status_code}; check credentials, board access or required interactive verification")
    json_object(response, "BRAIN login")
    # requests.Session retains Set-Cookie, as the referenced wq_mining client does.


def field_value(record, path):
    for part in path.split("."):
        if not isinstance(record, dict) or part not in record:
            raise SyncError("Board row is missing the configured ID/country field")
        record = record[part]
    return record


def normalize_member(record, user_field="user", country_field="country"):
    user = field_value(record, user_field)
    country = field_value(record, country_field)
    if not isinstance(user, str) or not 2 <= len(user.strip()) <= 64:
        raise SyncError("Board row has an invalid user ID; check WQ_USER_FIELD")
    if not isinstance(country, str) or not re.fullmatch(r"[A-Za-z]{2}", country.strip()):
        raise SyncError("Board row has an invalid country code; check WQ_COUNTRY_FIELD")
    return {"wqId": user.strip().upper(), "country": country.strip().upper()}


def fetch_members(session, username, password, board_date, *, user_field="user", country_field="country", sleeper=time.sleep):
    login(session, username, password, sleeper=sleeper)
    members = []
    seen = set()
    expected = None
    offset = 0
    while offset <= MAX_MEMBERS:
        params = {"limit": 100, "offset": offset, "date": board_date, "aggregate": "user"}
        response = request(session, "GET", BRAIN_URL + BOARD_PATH, params=params, sleeper=sleeper)
        if response.status_code == 401:
            login(session, username, password, sleeper=sleeper)
            response = request(session, "GET", BRAIN_URL + BOARD_PATH, params=params, sleeper=sleeper)
        payload = json_object(response, f"BRAIN board offset {offset}")
        results = payload.get("results")
        if not isinstance(results, list):
            raise SyncError("Board response is missing results")
        if "count" in payload:
            count = payload["count"]
            if type(count) is not int or not 1 <= count <= MAX_MEMBERS:
                raise SyncError("Board count is empty or invalid; no import performed")
            if expected is not None and count != expected:
                raise SyncError("Board count changed while paginating; retry for a complete snapshot")
            expected = count
        for record in results:
            member = normalize_member(record, user_field, country_field)
            if member["wqId"] in seen:
                raise SyncError("Duplicate user across board pages; refusing a potentially incomplete snapshot")
            seen.add(member["wqId"])
            members.append(member)
        offset += len(results)
        if offset > MAX_MEMBERS or (expected is not None and offset > expected):
            raise SyncError("Board contains more rows than expected")
        if expected is not None and offset == expected:
            break
        if not results and payload.get("next"):
            raise SyncError("Board returned an empty page with more pages advertised")
        if not results or ("next" in payload and payload["next"] is None):
            if expected is not None and offset != expected:
                raise SyncError("Board ended before all expected members were fetched")
            break
        # Offset uses actual rows (servers may cap limit); never follow arbitrary URLs.
        sleeper(0.5)
    if not members:
        raise SyncError("Board is empty; no import performed")
    return members


def sync_members(session, api_url, token, members, board_date, *, sleeper=time.sleep):
    if not members:
        raise SyncError("Refusing an empty import")
    base = api_url.rstrip("/") + "/v1/automation/member-imports"
    headers = {"Authorization": f"Bearer {token}"}
    created = json_object(request(session, "POST", base, headers=headers,
        json={"expectedRows": len(members), "boardDate": board_date}, sleeper=sleeper), "Create import")
    import_id = created.get("importId")
    if not isinstance(import_id, str) or not re.fullmatch(r"[a-fA-F0-9-]{36}", import_id):
        raise SyncError("Calendar returned an invalid import ID")
    for offset in range(0, len(members), 100):
        rows = members[offset:offset + 100]
        staged = json_object(request(session, "POST", f"{base}/{import_id}/rows", headers=headers,
            json={"rows": rows}, sleeper=sleeper), "Stage members")
        if staged.get("stagedRows") != offset + len(rows):
            raise SyncError("Staged member count mismatch; no commit performed")
    preview = json_object(request(session, "GET", f"{base}/{import_id}", headers=headers, sleeper=sleeper), "Check import")
    batch = preview.get("batch", {})
    if not isinstance(batch, dict) or batch.get("total_rows") != len(members) or batch.get("expected_rows") != len(members) or batch.get("status") != "staging":
        raise SyncError("Final staged count/status mismatch; no commit performed")
    result = json_object(request(session, "POST", f"{base}/{import_id}/commit", headers=headers, json={}, sleeper=sleeper), "Commit members")
    if result.get("committed") is not True or result.get("importedRows") != len(members):
        raise SyncError("Calendar did not confirm the complete import")
    return result


def required_env(name):
    value = os.environ.get(name, "")
    if not value.strip():
        raise SyncError(f"Missing configuration: {name}")
    return value


def main():
    username = required_env("WQ_USERNAME")
    password = required_env("WQ_PASSWORD")
    api_url = required_env("CALENDAR_API_URL").strip()
    parsed = urlsplit(api_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SyncError("CALENDAR_API_URL must be an HTTPS URL without credentials, query or fragment")
    token = required_env("MEMBER_SYNC_TOKEN").strip()
    if len(token) < 32 or re.search(r"\s", token):
        raise SyncError("MEMBER_SYNC_TOKEN must contain at least 32 non-whitespace characters")
    # Yesterday in Beijing by default; historical dates are explicitly configurable.
    default_date = (datetime.now(timezone(timedelta(hours=8))) - timedelta(days=1)).date().isoformat()
    board_date = os.environ.get("WQ_BOARD_DATE", "").strip() or default_date
    try:
        if date.fromisoformat(board_date).isoformat() != board_date:
            raise ValueError
    except ValueError:
        raise SyncError("WQ_BOARD_DATE must be YYYY-MM-DD") from None
    # Separate sessions guarantee BRAIN cookies/Basic auth never reach the calendar.
    with requests.Session() as brain, requests.Session() as calendar:
        brain.trust_env = False
        calendar.trust_env = False
        members = fetch_members(brain, username, password, board_date,
            user_field=os.environ.get("WQ_USER_FIELD") or "user",
            country_field=os.environ.get("WQ_COUNTRY_FIELD") or "country")
        print(f"Fetched complete board: {len(members)} members, date {board_date}")
        result = sync_members(calendar, api_url, token, members, board_date)
        print(f"Committed {result['importedRows']} members (merge); active members: {result['activeMembers']}")


if __name__ == "__main__":
    try:
        main()
    except SyncError as error:
        print(f"Member sync failed: {error}", file=sys.stderr)
        sys.exit(1)
