"""Iteration 36 backend tests.

Coverage:
- GET /api/analytics/new-styles-curve (days=60, 122, 180) shape + auth
- GET /api/analytics/sor-all-styles regression (catalog-wide list)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"

# Cold call can take 30-60s — these are 6-month fan-outs over /orders.
LONG_TIMEOUT = 240
ALLOWED_TRENDS = {"climbing", "plateau", "declining", "no-sales"}


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token in login response: {r.json()}"
    return token


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ---------------------------------------------------------------------------
# /analytics/new-styles-curve  — auth + shape
# ---------------------------------------------------------------------------
class TestNewStylesCurve:
    def test_unauth_returns_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/analytics/new-styles-curve?days=60", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    @pytest.mark.parametrize("days", [60, 122, 180])
    def test_curve_shape_for_days(self, auth_headers, days):
        r = requests.get(
            f"{BASE_URL}/api/analytics/new-styles-curve",
            params={"days": days},
            headers=auth_headers,
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, f"days={days}: {r.status_code} {r.text[:200]}"
        body = r.json()
        # top-level shape
        assert isinstance(body, dict)
        assert body.get("days") == days
        assert "as_of" in body and isinstance(body["as_of"], str) and len(body["as_of"]) == 10
        rows = body.get("rows")
        assert isinstance(rows, list), "rows must be a list"
        assert len(rows) > 0, f"no rows returned for days={days}"
        # row shape — sample first 3
        for row in rows[:3]:
            for k in (
                "style_name", "brand", "subcategory", "first_sale",
                "weeks_since_launch", "weekly", "total_units",
                "total_sales", "peak_weekly_units", "trend",
            ):
                assert k in row, f"missing key {k} in row: {row}"
            assert row["trend"] in ALLOWED_TRENDS, f"bad trend: {row['trend']}"
            assert isinstance(row["weekly"], list) and len(row["weekly"]) > 0
            for w in row["weekly"]:
                for wk in ("week_index", "week_start", "units", "sales"):
                    assert wk in w, f"missing weekly key {wk}: {w}"
            assert row["peak_weekly_units"] >= 0
            # weekly units sum should match total_units (allow small rounding tolerance)
            wsum = sum(int(w["units"]) for w in row["weekly"])
            assert wsum == int(row["total_units"]), (
                f"weekly units {wsum} != total_units {row['total_units']} for {row['style_name']}"
            )
        print(f"days={days}: rows={len(rows)} sample_trends="
              f"{sorted({r['trend'] for r in rows[:50]})}")

    def test_curve_default_days_is_122(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/new-styles-curve",
            headers=auth_headers,
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json().get("days") == 122


# ---------------------------------------------------------------------------
# /analytics/sor-all-styles  — regression (used by Inventory variant section)
# ---------------------------------------------------------------------------
class TestSorAllStylesRegression:
    def test_unauth_returns_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/analytics/sor-all-styles", timeout=30)
        assert r.status_code in (401, 403)

    def test_returns_catalog_list(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-all-styles",
            headers=auth_headers,
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        # endpoint historically returns either a list or {styles: [...]} — accept both.
        rows = body if isinstance(body, list) else (body.get("styles") or body.get("rows") or [])
        assert isinstance(rows, list)
        assert len(rows) > 100, f"expected >100 catalog rows, got {len(rows)}"
        sample = rows[0]
        for k in ("style_name", "soh_total", "units_6m"):
            assert k in sample, f"missing {k} in sor-all-styles row: {sample}"
        # uniqueness sanity check
        names = [r["style_name"] for r in rows]
        assert len(names) == len(set(names)), "duplicate style_name detected"
        print(f"sor-all-styles rows={len(rows)}")
