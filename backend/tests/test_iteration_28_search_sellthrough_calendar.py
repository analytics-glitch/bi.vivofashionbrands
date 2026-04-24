"""Iteration 28 tests:
  - GET /api/search (⌘K global search)
  - GET /api/analytics/sell-through-by-location
  - GET /api/footfall/daily-calendar
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # load from frontend/.env as a fallback, so tests can run anywhere.
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


# ─── fixtures ──────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(session):
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_client(session, token):
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


# ─── /api/search ───────────────────────────────────────────────────
class TestGlobalSearch:
    def test_requires_auth(self, session):
        # clean session without token (module token fixture may have set auth already)
        plain = requests.Session()
        r = plain.get(f"{BASE_URL}/api/search", params={"q": "vivo"}, timeout=10)
        assert r.status_code in (401, 403), r.status_code

    def test_empty_query_returns_422(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/search", params={"q": ""}, timeout=15)
        assert r.status_code == 422, r.status_code

    def test_search_vivo_grouped_payload(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/search", params={"q": "vivo"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for key in ("q", "pages", "stores", "styles", "customers", "total"):
            assert key in d, f"missing key {key}: {list(d.keys())}"
        assert isinstance(d["pages"], list)
        assert isinstance(d["stores"], list)
        assert isinstance(d["styles"], list)
        assert isinstance(d["customers"], list)
        assert isinstance(d["total"], int)
        for group in ("pages", "stores", "styles", "customers"):
            for item in d[group]:
                assert "link" in item, f"missing link in {group} item {item}"

    def test_search_page_by_label(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/search", params={"q": "inventory"}, timeout=15)
        assert r.status_code == 200
        pages = r.json().get("pages", [])
        matches = [p for p in pages if p.get("link") == "/inventory"]
        assert matches, f"expected Inventory page match, got {pages}"


# ─── /api/analytics/sell-through-by-location ───────────────────────
class TestSellThroughByLocation:
    def test_missing_dates_returns_400(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/analytics/sell-through-by-location", timeout=15)
        assert r.status_code == 400, r.status_code

    def test_returns_rows_with_expected_shape(self, auth_client):
        r = auth_client.get(
            f"{BASE_URL}/api/analytics/sell-through-by-location",
            params={"date_from": "2026-03-01", "date_to": "2026-04-01"},
            timeout=90,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list)
        if not rows:
            pytest.skip("No rows returned for period — upstream may have no data")
        expected_keys = {
            "location", "country", "units_sold", "current_stock",
            "total_sales", "net_sales", "sell_through_pct", "health",
        }
        for row in rows:
            missing = expected_keys - set(row.keys())
            assert not missing, f"row missing {missing}: {row}"
            assert row["health"] in {"strong", "healthy", "slow", "stuck", "no_stock_data"}, row["health"]

        real_rows = [r for r in rows if r["sell_through_pct"] is not None]
        if len(real_rows) >= 2:
            pcts = [r["sell_through_pct"] for r in real_rows]
            assert pcts == sorted(pcts, reverse=True), \
                f"real sell-through rows not sorted desc: {pcts}"

        # no_stock_data rows: stock=0 and pct=None
        for r in rows:
            if r["health"] == "no_stock_data":
                assert r["sell_through_pct"] is None
                assert (r["current_stock"] or 0) == 0


# ─── /api/footfall/daily-calendar ──────────────────────────────────
class TestFootfallDailyCalendar:
    def test_invalid_date_returns_400(self, auth_client):
        r = auth_client.get(
            f"{BASE_URL}/api/footfall/daily-calendar",
            params={"date_from": "not-a-date", "date_to": "2026-04-01"},
            timeout=15,
        )
        assert r.status_code == 400, r.status_code

    def test_returns_calendar_shape(self, auth_client):
        r = auth_client.get(
            f"{BASE_URL}/api/footfall/daily-calendar",
            params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
            timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "window" in d and "max_footfall" in d and "days" in d
        assert {"start", "end", "days"} <= set(d["window"].keys())
        assert d["window"]["start"] == "2026-04-01"
        assert d["window"]["end"] == "2026-04-24"
        assert d["window"]["days"] == 24
        assert len(d["days"]) == 24
        for day in d["days"]:
            assert {"date", "weekday", "footfall", "orders", "total_sales", "conversion_rate"} <= set(day.keys())
            assert 0 <= day["weekday"] <= 6

    def test_clamps_window_to_90_days(self, auth_client):
        # request 180 days — server should clamp to 90
        r = auth_client.get(
            f"{BASE_URL}/api/footfall/daily-calendar",
            params={"date_from": "2025-10-01", "date_to": "2026-04-01"},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["window"]["days"] <= 90, f"expected ≤90 days, got {d['window']['days']}"
