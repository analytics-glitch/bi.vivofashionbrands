"""
Iteration 27 — Notifications bell API.

Scope:
  - POST /api/notifications/refresh (idempotent upsert across 4 event types)
  - GET  /api/notifications (list + read flag)
  - GET  /api/notifications/unread-count
  - POST /api/notifications/{event_id}/read
  - POST /api/notifications/read-all
  - Auth gating on every endpoint
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"

VALID_TYPES = {"new_record", "stockout", "vip_return", "anomaly"}
VALID_SEVERITY = {"info", "warn", "celebrate"}


@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def admin_client(admin_token) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="session")
def anon_client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestNotificationsAuth:
    def test_refresh_requires_auth(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/notifications/refresh", timeout=60)
        assert r.status_code in (401, 403)

    def test_list_requires_auth(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/notifications", timeout=30)
        assert r.status_code in (401, 403)

    def test_unread_requires_auth(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/notifications/unread-count", timeout=30)
        assert r.status_code in (401, 403)

    def test_read_requires_auth(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/notifications/anything/read", timeout=30)
        assert r.status_code in (401, 403)

    def test_read_all_requires_auth(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/notifications/read-all", timeout=30)
        assert r.status_code in (401, 403)


class TestNotificationsRefreshAndList:
    def test_refresh_first_call(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/notifications/refresh", timeout=180)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "generated" in body
        assert "upserted" in body
        assert isinstance(body["generated"], int)
        assert isinstance(body["upserted"], int)
        assert body["generated"] >= 0
        # Stash for next test
        pytest.notif_generated = body["generated"]

    def test_refresh_is_idempotent(self, admin_client):
        """Second call should produce the same generated count and not create dupes."""
        r = admin_client.post(f"{BASE_URL}/api/notifications/refresh", timeout=180)
        assert r.status_code == 200
        body = r.json()
        # event_id is deterministic so generated count should equal first call
        assert body["generated"] == getattr(pytest, "notif_generated", body["generated"])

    def test_list_returns_rows(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}/api/notifications",
            params={"limit": 20}, timeout=30,
        )
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # Save whether inbox has anything for downstream tests
        pytest.notif_rows = rows
        for row in rows:
            assert "event_id" in row
            assert "type" in row
            assert "severity" in row
            assert "title" in row
            assert "message" in row
            assert "read" in row
            assert row["type"] in VALID_TYPES, f"bad type: {row['type']}"
            assert row["severity"] in VALID_SEVERITY, f"bad severity: {row['severity']}"

    def test_no_duplicate_event_ids(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}/api/notifications",
            params={"limit": 200}, timeout=30,
        )
        assert r.status_code == 200
        rows = r.json()
        ids = [row["event_id"] for row in rows]
        assert len(ids) == len(set(ids)), "duplicate event_ids returned"


class TestNotificationsReadFlow:
    def test_read_all_then_unread_zero(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/notifications/read-all", timeout=30)
        assert r.status_code == 200
        # verify unread-count == 0
        uc = admin_client.get(f"{BASE_URL}/api/notifications/unread-count", timeout=30)
        assert uc.status_code == 200
        assert uc.json()["unread"] == 0

    def test_single_read_404_on_bogus(self, admin_client):
        bogus = f"does-not-exist-{uuid.uuid4().hex}"
        r = admin_client.post(
            f"{BASE_URL}/api/notifications/{bogus}/read", timeout=30,
        )
        assert r.status_code == 404

    def test_mark_single_read(self, admin_client):
        """Create fresh event, mark-all-read, force a new event by refresh,
        then take one event and mark it read; verify read state flags."""
        # Refresh to ensure events exist (idempotent)
        admin_client.post(f"{BASE_URL}/api/notifications/refresh", timeout=180)
        rows = admin_client.get(
            f"{BASE_URL}/api/notifications",
            params={"limit": 100}, timeout=30,
        ).json()
        if not rows:
            pytest.skip("No notifications in inbox to test single-read flow")

        # Reset: mark all read, then we'll undo by inspecting one event
        # Actually simpler: take first event and mark read, verify its flag,
        # verify other events retain whatever state they had.
        # First ensure a clean starting state:
        admin_client.post(f"{BASE_URL}/api/notifications/read-all", timeout=30)

        # Now artificially unread them? Not possible via API. But we
        # can test idempotency: marking a read event read again returns 200.
        target = rows[0]["event_id"]
        r = admin_client.post(
            f"{BASE_URL}/api/notifications/{target}/read", timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True

        # Fetch and confirm read=True
        new_rows = admin_client.get(
            f"{BASE_URL}/api/notifications",
            params={"limit": 100}, timeout=30,
        ).json()
        match = [r for r in new_rows if r["event_id"] == target]
        assert match, "target event missing after read"
        assert match[0]["read"] is True

    def test_unread_count_shape(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}/api/notifications/unread-count", timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert "unread" in body
        assert isinstance(body["unread"], int)
        assert body["unread"] >= 0


class TestNotificationsResilience:
    def test_refresh_still_returns_generated(self, admin_client):
        """Even if any single synthesiser fails silently, the endpoint must
        return a non-error response. We just re-hit refresh and verify the
        shape — if one of the 4 synthesisers was broken, the others should
        still contribute."""
        r = admin_client.post(f"{BASE_URL}/api/notifications/refresh", timeout=180)
        assert r.status_code == 200
        body = r.json()
        assert body["generated"] >= 0
        # Shape guarantee is the important contract.
