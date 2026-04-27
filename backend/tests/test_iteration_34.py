"""Iteration 34 backend tests.

Covers:
  - GET /api/search timeboxing (fast, customers may be empty for short q)
  - GET /api/search/customers — new dedicated customer search endpoint
  - GET /api/customers/walk-ins — by_location field added
  - GET /api/analytics/ibt-sku-breakdown — new endpoint
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PW = "VivoAdmin!2026"


@pytest.fixture(scope="session")
def token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    return tok


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- /api/search ---------------------------------------------------------

class TestGlobalSearch:
    def test_search_fast_long_query(self, auth_headers):
        """Long query (>=3 chars) — should respond < 3.5s and include groups."""
        t0 = time.time()
        r = requests.get(
            f"{BASE_URL}/api/search",
            params={"q": "sarit", "limit": 5},
            headers=auth_headers,
            timeout=8,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["pages", "stores", "styles", "customers", "total"]:
            assert k in data, f"missing key: {k}"
        # Hard ceiling: previous bug was 3-4s; with timebox should be <3s.
        assert elapsed < 3.5, f"/api/search took {elapsed:.2f}s (>3.5s limit)"

    def test_search_short_query_skips_customers(self, auth_headers):
        """For len(q) < 3, customers must be skipped (empty list) and fast."""
        t0 = time.time()
        r = requests.get(
            f"{BASE_URL}/api/search",
            params={"q": "vi", "limit": 5},
            headers=auth_headers,
            timeout=5,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["customers"] == [], "short query must skip customers"
        assert elapsed < 1.5, f"short-query search slow: {elapsed:.2f}s"

    def test_search_unauth(self):
        r = requests.get(
            f"{BASE_URL}/api/search", params={"q": "vivo"}, timeout=5
        )
        assert r.status_code in (401, 403)


class TestCustomerSearch:
    def test_customers_endpoint_long_query(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/search/customers",
            params={"q": "sarit", "limit": 5},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "customers" in data
        assert isinstance(data["customers"], list)

    def test_customers_endpoint_short_query_returns_empty(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/search/customers",
            params={"q": "ab", "limit": 5},
            headers=auth_headers,
            timeout=5,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("customers") == []

    def test_customers_endpoint_unauth(self):
        r = requests.get(
            f"{BASE_URL}/api/search/customers",
            params={"q": "sarit"},
            timeout=5,
        )
        assert r.status_code in (401, 403)


# --- /api/customers/walk-ins  by_location -------------------------------

class TestWalkInsByLocation:
    def test_walk_ins_includes_by_location(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/customers/walk-ins",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "by_location" in data, "by_location must be present in iter_34"
        assert isinstance(data["by_location"], list)
        assert len(data["by_location"]) > 0, "expected at least one store row"
        row = data["by_location"][0]
        # iter_34 backend uses: channel, country, walk_in_orders, walk_in_sales,
        # total_orders, total_sales, walk_in_share_orders_pct, capture_rate_pct
        for k in (
            "channel",
            "country",
            "walk_in_orders",
            "walk_in_sales",
            "total_orders",
            "total_sales",
            "walk_in_share_orders_pct",
            "capture_rate_pct",
        ):
            assert k in row, f"by_location row missing {k}: {row}"
        # walk_in_orders cannot exceed total_orders
        assert row["walk_in_orders"] <= row["total_orders"]
        # capture_rate_pct ≈ 100 - walk_in_share_orders_pct
        assert abs(row["capture_rate_pct"] - (100 - row["walk_in_share_orders_pct"])) < 0.05


# --- /api/analytics/ibt-sku-breakdown -----------------------------------

class TestIbtSkuBreakdown:
    @pytest.fixture(scope="class")
    def ibt_pick(self, auth_headers):
        """Grab the top IBT suggestion to drive the breakdown test."""
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=auth_headers,
            timeout=180,
        )
        if r.status_code != 200:
            pytest.skip(f"ibt-suggestions {r.status_code}: {r.text[:120]}")
        rows = r.json()
        if not rows:
            pytest.skip("no IBT suggestions to drill into")
        # rows is already sorted desc by est_uplift
        return rows[0]

    def test_ibt_breakdown_shape(self, auth_headers, ibt_pick):
        params = {
            "style_name": ibt_pick.get("style_name") or ibt_pick.get("style"),
            "from_store": ibt_pick.get("from_store"),
            "to_store": ibt_pick.get("to_store"),
            "units_to_move": ibt_pick.get("units_to_move") or 0,
        }
        t0 = time.time()
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-sku-breakdown",
            params=params,
            headers=auth_headers,
            timeout=60,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        data = r.json()
        for k in (
            "style_name",
            "from_store",
            "to_store",
            "skus",
            "from_total",
            "to_total",
            "suggested_total",
        ):
            assert k in data, f"missing key {k}"
        assert data["style_name"] == params["style_name"]
        assert data["from_store"] == params["from_store"]
        assert data["to_store"] == params["to_store"]
        assert isinstance(data["skus"], list)
        assert len(data["skus"]) > 0, "expected at least one SKU"
        sku = data["skus"][0]
        for k in (
            "sku",
            "color",
            "size",
            "from_available",
            "to_available",
            "suggested_qty",
        ):
            assert k in sku, f"sku missing {k}: {sku}"
        # Totals consistency
        assert data["from_total"] == sum(s["from_available"] for s in data["skus"])
        assert data["to_total"] == sum(s["to_available"] for s in data["skus"])
        assert data["suggested_total"] == sum(s["suggested_qty"] for s in data["skus"])
        # Check at least one SKU has suggested_qty > 0 when there's any
        # gap at TO (i.e., to_available < 3 for some SKU AND from has stock).
        gap_exists = any(
            s["to_available"] < 3 and s["from_available"] > 0 for s in data["skus"]
        )
        if gap_exists:
            assert any(
                s["suggested_qty"] > 0 for s in data["skus"]
            ), "expected suggested_qty>0 when TO has gap and FROM has stock"
        # Cold cache should still be reasonable
        assert elapsed < 30, f"ibt-sku-breakdown too slow: {elapsed:.2f}s"

    def test_ibt_breakdown_unauth(self):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-sku-breakdown",
            params={
                "style_name": "X",
                "from_store": "Y",
                "to_store": "Z",
            },
            timeout=10,
        )
        assert r.status_code in (401, 403)
