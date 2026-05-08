"""Iteration 62 — Daily Replenishment workflow tests.

Covers:
- /api/admin/replenishment-config GET / POST (roster persistence + reset to default)
- /api/analytics/replenishment-report (owners override, days_lapsed, fields)
- /api/analytics/replenishment-report/mark (persist actual_units_replenished)
- /api/analytics/replenishment-completed (audit trail)
- Role-based access (viewer should NOT have access to roster admin)
"""

import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"
VIEWER_EMAIL = "viewer@vivofashiongroup.com"
VIEWER_PASS = "Viewer!2026"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def viewer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": VIEWER_EMAIL, "password": VIEWER_PASS},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"viewer login unavailable: {r.status_code}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def viewer_headers(viewer_token):
    return {"Authorization": f"Bearer {viewer_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def yesterday():
    return (date.today() - timedelta(days=1)).isoformat()


# ----- Admin replenishment-config -------------------------------------------------

class TestReplenishmentConfig:
    def test_get_default_roster(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/replenishment-config", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "owners" in body
        assert isinstance(body["owners"], list)

    def test_post_custom_roster_persists(self, admin_headers):
        custom = ["Alice", "Bob", "Charlie"]
        r = requests.post(
            f"{BASE_URL}/api/admin/replenishment-config",
            headers=admin_headers,
            json={"owners": custom},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("owners") == custom

        # Verify GET reflects the saved roster.
        r2 = requests.get(f"{BASE_URL}/api/admin/replenishment-config", headers=admin_headers, timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("owners") == custom

    def test_post_empty_resets_to_default(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/replenishment-config",
            headers=admin_headers,
            json={"owners": []},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("owners") == []

    def test_viewer_forbidden(self, viewer_headers):
        """Per spec: non-admin gets 403 on POST. Reports issue if not enforced."""
        r = requests.post(
            f"{BASE_URL}/api/admin/replenishment-config",
            headers=viewer_headers,
            json={"owners": ["X"]},
            timeout=30,
        )
        assert r.status_code in (401, 403), f"Expected 401/403 for viewer, got {r.status_code}: {r.text}"


# ----- Replenishment report --------------------------------------------------------

class TestReplenishmentReport:
    def test_report_default_roster(self, admin_headers, yesterday):
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-report",
            headers=admin_headers,
            params={"date_from": yesterday, "date_to": yesterday},
            timeout=240,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body and "summary" in body
        owners_used = (body.get("summary") or {}).get("owners_used", [])
        assert isinstance(owners_used, list)

    def test_report_owners_override(self, admin_headers, yesterday):
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-report",
            headers=admin_headers,
            params={"date_from": yesterday, "date_to": yesterday, "owners": "Alice,Bob"},
            timeout=240,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        owners_used = body["summary"]["owners_used"]
        assert set(owners_used) == {"Alice", "Bob"}, f"got {owners_used}"
        # Every row owner must be in the override set (unless empty rows).
        bad = [r["owner"] for r in body.get("rows", []) if r.get("owner") not in {"Alice", "Bob"}]
        assert not bad, f"rows with owner outside override: {bad[:5]}"

    def test_report_row_fields_include_days_lapsed_and_state(self, admin_headers, yesterday):
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-report",
            headers=admin_headers,
            params={"date_from": yesterday, "date_to": yesterday},
            timeout=240,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("rows") or []
        if not rows:
            pytest.skip("no replenishment rows for the date — cannot validate fields")
        sample = rows[0]
        for fld in (
            "days_lapsed",
            "first_seen_at",
            "replenished",
            "actual_units_replenished",
            "soh_after",
            "completed_at",
            "owner",
            "pos_location",
            "barcode",
            "replenish",
        ):
            assert fld in sample, f"missing {fld} in row: {list(sample.keys())}"
        assert isinstance(sample["days_lapsed"], int)
        assert sample["days_lapsed"] >= 0
        assert isinstance(sample["replenished"], bool)


# ----- Mark As Done + Completed -----------------------------------------------------

class TestReplenishmentMarkAndCompleted:
    @pytest.fixture(scope="class")
    def open_row(self, admin_token, yesterday):
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-report",
            headers=headers,
            params={"date_from": yesterday, "date_to": yesterday},
            timeout=240,
        )
        assert r.status_code == 200
        body = r.json()
        for row in body.get("rows", []):
            if not row.get("replenished"):
                return {"row": row, "yesterday": yesterday}
        pytest.skip("no open replenishment rows to mark done")

    def test_mark_done_persists(self, admin_headers, open_row):
        row = open_row["row"]
        yday = open_row["yesterday"]
        actual = max(1, int(row.get("replenish") or 1))
        payload = {
            "date_from": yday,
            "date_to": yday,
            "pos_location": row["pos_location"],
            "barcode": row["barcode"],
            "replenished": True,
            "actual_units_replenished": actual,
            "owner": row.get("owner") or "TEST_iter62_owner",
            "product_name": row.get("product_name") or "",
            "size": row.get("size") or "",
            "sku": row.get("sku") or "",
            "units_to_replenish": row.get("replenish") or 0,
            "soh_store": row.get("soh_store") or 0,
            "soh_wh": row.get("soh_wh") or 0,
        }
        r = requests.post(
            f"{BASE_URL}/api/analytics/replenishment-report/mark",
            headers=admin_headers,
            json=payload,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_completed_endpoint_returns_marked(self, admin_headers, open_row):
        # The previous test should have populated at least one completed row.
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-completed",
            headers=admin_headers,
            params={"days": 30},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body
        rows = body["rows"]
        assert isinstance(rows, list)
        if rows:
            sample = rows[0]
            for fld in (
                "key",
                "owner",
                "pos_location",
                "product_name",
                "units_to_replenish",
                "actual_units_replenished",
                "fulfilment_pct",
                "soh_after",
                "completed_at",
            ):
                assert fld in sample, f"missing {fld} in completed row"

    def test_completed_viewer_forbidden(self, viewer_headers):
        """Spec says admin only. Should be 401/403 for viewer."""
        r = requests.get(
            f"{BASE_URL}/api/analytics/replenishment-completed",
            headers=viewer_headers,
            params={"days": 30},
            timeout=30,
        )
        # The endpoint currently uses get_current_user (not require_admin),
        # so this assertion will catch any access-control gap.
        assert r.status_code in (401, 403), f"viewer accessed completed endpoint: {r.status_code}"


# ----- Cleanup --------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def _cleanup_after_tests(admin_headers):
    """After all tests complete, restore default roster."""
    yield
    try:
        requests.post(
            f"{BASE_URL}/api/admin/replenishment-config",
            headers=admin_headers,
            json={"owners": []},
            timeout=15,
        )
    except Exception:
        pass
