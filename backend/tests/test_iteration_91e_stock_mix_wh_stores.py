"""Iteration 91e — Backend tests for Stock Mix warehouse/stores split
and custom date range on /api/exec-summary.

Validates:
  * Custom date range (date_from + date_to) is honoured.
  * Swap behaviour when date_from > date_to.
  * Fallback to window_days when only one of from/to is provided.
  * stock_mix payload exposes warehouse + stores fields at every tier.
  * Invariant: warehouse + stores == stock_units (per row & total).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"
ROUND_TOL = 1.0  # < 1 unit tolerance per RC instruction


# ── Fixtures ───────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _get_exec(headers, **params):
    r = requests.get(
        f"{BASE_URL}/api/exec-summary",
        headers=headers,
        params=params,
        timeout=120,
    )
    assert r.status_code == 200, f"exec-summary {params} -> {r.status_code} {r.text[:200]}"
    return r.json()


# ── Custom date range honoured ─────────────────────────────────────────
class TestCustomRange:
    def test_custom_range_honoured(self, auth_headers):
        data = _get_exec(auth_headers, date_from="2026-04-01", date_to="2026-04-30")
        sm = data.get("stock_mix") or {}
        sw = sm.get("sold_window") or {}
        assert sw.get("from") == "2026-04-01"
        assert sw.get("to") == "2026-04-30"
        assert sw.get("days") == 30
        assert sm.get("window_days") == 30

    def test_swapped_when_from_greater_than_to(self, auth_headers):
        data = _get_exec(auth_headers, date_from="2026-04-30", date_to="2026-04-01")
        sw = (data.get("stock_mix") or {}).get("sold_window") or {}
        # Swapped silently — from should be the earlier date
        assert sw.get("from") == "2026-04-01"
        assert sw.get("to") == "2026-04-30"

    def test_only_date_from_falls_back_to_window_days(self, auth_headers):
        data = _get_exec(auth_headers, date_from="2026-04-01", window_days=60)
        sm = data.get("stock_mix") or {}
        assert sm.get("window_days") == 60
        # The window must NOT match the custom 'from' since one half is missing
        assert (sm.get("sold_window") or {}).get("days") == 60

    def test_only_date_to_falls_back_to_window_days(self, auth_headers):
        data = _get_exec(auth_headers, date_to="2026-04-30", window_days=90)
        sm = data.get("stock_mix") or {}
        assert sm.get("window_days") == 90
        assert (sm.get("sold_window") or {}).get("days") == 90


# ── Warehouse / Stores split fields ────────────────────────────────────
class TestWarehouseStoresFields:
    @pytest.fixture(scope="class")
    def sm(self, auth_headers):
        return _get_exec(auth_headers, window_days=30)["stock_mix"]

    def test_total_fields_present(self, sm):
        for k in (
            "total_stock_units_warehouse",
            "total_stock_units_stores",
            "total_stock_pct_warehouse",
            "total_stock_pct_stores",
        ):
            assert k in sm, f"missing total field {k}"

    def test_total_warehouse_plus_stores_equals_total(self, sm):
        total = float(sm.get("total_stock_units") or 0)
        wh = float(sm.get("total_stock_units_warehouse") or 0)
        st = float(sm.get("total_stock_units_stores") or 0)
        assert abs((wh + st) - total) < ROUND_TOL, (
            f"total mismatch: total={total} wh={wh} st={st}"
        )

    def test_total_pcts_sum_to_100(self, sm):
        wh_p = float(sm.get("total_stock_pct_warehouse") or 0)
        st_p = float(sm.get("total_stock_pct_stores") or 0)
        # Allow 0 case when total stock is empty
        if float(sm.get("total_stock_units") or 0) > 0:
            assert abs((wh_p + st_p) - 100.0) < 0.5

    def test_category_rows_have_split_fields(self, sm):
        for row in sm.get("categories") or []:
            for k in (
                "stock_units_warehouse",
                "stock_units_stores",
                "stock_pct_warehouse",
                "stock_pct_stores",
            ):
                assert k in row, f"missing {k} on cat row {row.get('category')}"
            stock = float(row.get("stock_units") or 0)
            wh = float(row.get("stock_units_warehouse") or 0)
            st = float(row.get("stock_units_stores") or 0)
            assert abs((wh + st) - stock) < ROUND_TOL, (
                f"cat {row.get('category')}: {wh}+{st}!={stock}"
            )

    def test_subcategory_rows_have_split_fields(self, sm):
        for row in sm.get("categories") or []:
            for sub in row.get("subcategories") or []:
                for k in (
                    "stock_units_warehouse",
                    "stock_units_stores",
                    "stock_pct_warehouse",
                    "stock_pct_stores",
                ):
                    assert k in sub, (
                        f"missing {k} on sub {sub.get('subcategory')}"
                    )
                stock = float(sub.get("stock_units") or 0)
                wh = float(sub.get("stock_units_warehouse") or 0)
                st = float(sub.get("stock_units_stores") or 0)
                assert abs((wh + st) - stock) < ROUND_TOL, (
                    f"sub {sub.get('subcategory')}: {wh}+{st}!={stock}"
                )

    def test_per_row_pcts_sum_to_100_when_stocked(self, sm):
        for row in sm.get("categories") or []:
            if float(row.get("stock_units") or 0) <= 0:
                continue
            p = float(row.get("stock_pct_warehouse") or 0) + float(row.get("stock_pct_stores") or 0)
            assert abs(p - 100.0) < 0.5, f"cat {row.get('category')} pct sum {p}"


# ── Custom range still produces a valid split ──────────────────────────
class TestCustomRangeWithSplit:
    def test_custom_range_keeps_split_invariant(self, auth_headers):
        data = _get_exec(auth_headers, date_from="2026-03-01", date_to="2026-03-31")
        sm = data["stock_mix"]
        total = float(sm.get("total_stock_units") or 0)
        wh = float(sm.get("total_stock_units_warehouse") or 0)
        st = float(sm.get("total_stock_units_stores") or 0)
        assert abs((wh + st) - total) < ROUND_TOL
