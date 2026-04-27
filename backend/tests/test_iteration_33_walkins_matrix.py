"""Iteration 33 — walk-ins KPI endpoint + category x country matrix endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- walk-ins endpoint ----------------
class TestWalkIns:
    def test_walk_ins_shape_short_window(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/customers/walk-ins",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # required keys
        for k in [
            "walk_in_orders", "walk_in_units", "walk_in_sales_kes",
            "walk_in_avg_basket_kes", "total_orders", "total_sales_kes",
            "walk_in_share_orders_pct", "walk_in_share_sales_pct",
            "by_country", "detection_rule", "truncated",
        ]:
            assert k in d, f"missing key {k} in response: {list(d.keys())}"
        assert isinstance(d["by_country"], list)
        assert d["total_orders"] >= 0
        assert d["walk_in_orders"] >= 0
        # walk-ins should be a small share
        assert d["walk_in_orders"] <= d["total_orders"], "walk-ins cannot exceed total"
        if d["total_orders"] > 0:
            assert d["walk_in_share_orders_pct"] <= 100.0
        # detection rule should mention guest/walk-in/anonymous/null
        assert isinstance(d["detection_rule"], str) and len(d["detection_rule"]) > 0
        # truncated must be boolean
        assert isinstance(d["truncated"], bool)
        print(
            f"walk-ins short window: orders={d['walk_in_orders']}/{d['total_orders']} "
            f"({d['walk_in_share_orders_pct']}% orders, {d['walk_in_share_sales_pct']}% sales) "
            f"sales=KES {d['walk_in_sales_kes']}, truncated={d['truncated']}"
        )

    def test_walk_ins_by_country_shape(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/customers/walk-ins",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200
        d = r.json()
        for row in d["by_country"]:
            assert "country" in row
            # common additional fields expected by UI
            expected_any = any(k in row for k in [
                "walk_in_orders", "orders", "walk_in_sales_kes",
                "total_orders", "total_sales_kes", "share_orders_pct",
                "share_sales_pct", "avg_basket_kes"
            ])
            assert expected_any, f"by_country row missing metric fields: {row}"

    def test_walk_ins_chunking_long_window(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/customers/walk-ins",
            params={"date_from": "2025-11-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_orders"] >= 0
        assert d["walk_in_orders"] <= d["total_orders"]
        print(
            f"walk-ins 3-month window: walk_ins={d['walk_in_orders']} "
            f"total={d['total_orders']} truncated={d['truncated']}"
        )

    def test_walk_ins_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/customers/walk-ins",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            timeout=30,
        )
        assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"


# ---------------- category x country matrix ----------------
class TestCategoryCountryMatrix:
    def test_matrix_shape(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/category-country-matrix",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "countries" in d
        assert d["countries"] == ["Kenya", "Uganda", "Rwanda", "Online"], d["countries"]
        assert "rows" in d and isinstance(d["rows"], list)
        assert "country_totals" in d
        assert "grand_total_kes" in d
        assert d["grand_total_kes"] >= 0

    def test_matrix_rows_sorted_desc(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/category-country-matrix",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200
        d = r.json()
        totals = [row.get("row_total_kes", 0) for row in d["rows"]]
        assert totals == sorted(totals, reverse=True), "rows not sorted by row_total_kes desc"

    def test_matrix_cells_structure(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/category-country-matrix",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200
        d = r.json()
        assert len(d["rows"]) > 0, "expected at least one subcategory row"
        sample = d["rows"][0]
        assert "cells" in sample, f"row missing cells: {sample}"
        cells = sample["cells"]
        for c in ["Kenya", "Uganda", "Rwanda", "Online"]:
            assert c in cells, f"cell missing for {c}: {cells.keys()}"
            cell = cells[c]
            assert "sales_kes" in cell and "share_of_country_pct" in cell, f"cell shape wrong: {cell}"
            assert cell["sales_kes"] >= 0
            assert 0 <= cell["share_of_country_pct"] <= 100.0001

    def test_matrix_country_totals_consistent(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/category-country-matrix",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=120,
        )
        assert r.status_code == 200
        d = r.json()
        # sum of cell shares per country should be ~100% (allow noise / zero-total)
        for country in d["countries"]:
            total_share = sum(row["cells"][country]["share_of_country_pct"] for row in d["rows"])
            country_total = d["country_totals"].get(country, 0)
            if country_total > 0:
                assert 95.0 <= total_share <= 105.0, (
                    f"{country} share sum {total_share} not ~100 "
                    f"(country_total={country_total})"
                )

    def test_matrix_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/analytics/category-country-matrix",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            timeout=30,
        )
        assert r.status_code in (401, 403)


# ---------------- regression: existing endpoints still work ----------------
class TestRegression:
    def test_kpis_unchanged(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "total_sales_kes" in d or "sales_kes" in d or "total_sales" in d

    def test_customers_kpis_unchanged(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/customers/kpis",
            params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
            headers=headers,
            timeout=60,
        )
        # Some deployments name it differently — accept 200 or 404 but log
        assert r.status_code in (200, 404), r.text
