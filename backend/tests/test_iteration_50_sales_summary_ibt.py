"""Iteration-50 backend tests:
   1) /api/analytics/total-sales-summary — display_name, country, group fields
   2) /api/analytics/ibt-suggestions — (style_name, to_store) deduped
   3) /api/analytics/ibt-sku-breakdown — supports warehouse FROM
"""
import os
from collections import Counter

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PW = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    t = r.json().get("token")
    assert t, "no token"
    return t


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── Total Sales Summary ─────────────────────────────────────────────
class TestTotalSalesSummary:
    def test_returns_rows_with_group_display_name_country(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/total-sales-summary",
            params={"month": "2026-04-01"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and isinstance(data["rows"], list)
        assert len(data["rows"]) > 0, "expected at least 1 store row"

        valid_groups = {"kenya_retail", "kenya_online", "uganda", "rwanda", "other"}
        for row in data["rows"]:
            assert "channel" in row
            assert "display_name" in row, f"missing display_name: {row}"
            assert "country" in row, f"missing country: {row}"
            assert "group" in row, f"missing group: {row}"
            assert row["group"] in valid_groups, (
                f"invalid group {row['group']!r} for {row.get('channel')}"
            )
            # display_name should be uppercase
            assert row["display_name"] == row["display_name"].upper()

    def test_grouping_distribution_makes_sense(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/total-sales-summary",
            params={"month": "2026-04-01"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200
        rows = r.json()["rows"]
        groups = Counter(row["group"] for row in rows)
        # Vivo has multiple Kenya retail stores, so kenya_retail must have
        # more than 1 entry.
        assert groups.get("kenya_retail", 0) >= 2, f"groups={dict(groups)}"

    def test_variance_fields_present(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/total-sales-summary",
            params={"month": "2026-04-01"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200
        rows = r.json()["rows"]
        # At least one row should have computed variance fields
        for row in rows:
            assert "mom_variance_pct" in row
            assert "yoy_variance_pct" in row
            assert "prior_month_same_window" in row
            assert "prior_year_same_window" in row


# ── IBT Suggestions Dedup ────────────────────────────────────────────
class TestIBTSuggestionsDedup:
    def test_each_style_to_store_pair_unique(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions",
            params={
                "date_from": "2026-04-01",
                "date_to": "2026-04-30",
                "limit": 200,
            },
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # response shape: list or {"suggestions": [...]}
        suggestions = data if isinstance(data, list) else (
            data.get("suggestions") or data.get("rows") or []
        )
        assert isinstance(suggestions, list)

        keys = [
            (s.get("style_name"), s.get("to_store"))
            for s in suggestions
            if s.get("style_name") and s.get("to_store")
        ]
        ctr = Counter(keys)
        dups = {k: v for k, v in ctr.items() if v > 1}
        assert not dups, (
            f"Found {len(dups)} duplicate (style, to_store) keys. Sample: "
            f"{list(dups.items())[:5]}"
        )


# ── IBT SKU Breakdown — Warehouse FROM support ───────────────────────
class TestIBTSkuBreakdownWarehouse:
    def test_warehouse_from_breakdown(self, headers):
        # Find a real (style, to_store) pair from the warehouse-to-store list.
        r1 = requests.get(
            f"{BASE_URL}/api/analytics/ibt-warehouse-to-store",
            params={
                "date_from": "2026-04-01",
                "date_to": "2026-04-30",
                "limit": 50,
            },
            headers=headers,
            timeout=120,
        )
        if r1.status_code != 200:
            pytest.skip(f"warehouse-to-stores endpoint unavailable: {r1.status_code}")
        wdata = r1.json()
        wsugs = wdata if isinstance(wdata, list) else (
            wdata.get("suggestions") or wdata.get("rows") or []
        )
        if not wsugs:
            pytest.skip("no warehouse-to-store suggestions to test breakdown against")

        first = wsugs[0]
        style = first.get("style_name")
        to_store = first.get("to_store")
        assert style and to_store

        r2 = requests.get(
            f"{BASE_URL}/api/analytics/ibt-sku-breakdown",
            params={
                "style_name": style,
                "from_store": "Warehouse Finished Goods",
                "to_store": to_store,
            },
            headers=headers,
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        data = r2.json()
        # Expect from_total > 0 since warehouse has stock for these styles
        from_total = data.get("from_total")
        assert from_total is not None, f"missing from_total field: {data}"
        assert from_total > 0, (
            f"warehouse from_total should be > 0 for style={style} -> {to_store}; got {from_total}"
        )
        # Expect skus[] with color/size dimensions
        skus = data.get("skus") or data.get("rows") or []
        assert isinstance(skus, list)
        assert len(skus) >= 1, f"expected at least 1 SKU breakdown row; got {data}"
        first_sku = skus[0]
        # Color or size keys should exist
        has_dim = any(k in first_sku for k in ("color", "size", "color_name", "size_name"))
        assert has_dim, f"SKU row missing color/size dims: {first_sku}"
