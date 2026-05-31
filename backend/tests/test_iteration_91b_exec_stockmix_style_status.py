"""
Iter 91b — Backend regression tests for the Executive Summary "Stock Mix"
style_status filter.

Verifies:
  - GET /api/exec-summary?style_status=all|active|retired returns the
    expected stock_mix.style_status echo and filtered inventory totals.
  - all == active + retired (within rounding tolerance) for inventory.
  - Sales (total_sold_units_mtd / total_sold_units_window) are IDENTICAL
    across all three filters (subcategory-sales are aggregated and not
    filtered by style).
  - Default (no param) behaves like 'all'.
  - Combinable with window_days=30/60/90 (both params ride along).
"""
import os
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"
TIMEOUT = 180


@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=60,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


def _fetch(headers, style_status=None, window_days=None):
    params = {}
    if style_status is not None:
        params["style_status"] = style_status
    if window_days is not None:
        params["window_days"] = window_days
    r = requests.get(
        f"{BASE_URL}/api/exec-summary",
        params=params,
        headers=headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, (
        f"exec-summary style={style_status} window={window_days} -> "
        f"{r.status_code} {r.text[:200]}"
    )
    return r.json()


@pytest.fixture(scope="module")
def payloads_30(headers):
    """Fetch with window_days=30 across the 3 style_status values."""
    return {
        "all": _fetch(headers, style_status="all", window_days=30),
        "active": _fetch(headers, style_status="active", window_days=30),
        "retired": _fetch(headers, style_status="retired", window_days=30),
    }


class TestStyleStatusEchoAndDefault:
    def test_echo_all(self, payloads_30):
        assert payloads_30["all"]["stock_mix"]["style_status"] == "all"

    def test_echo_active(self, payloads_30):
        assert payloads_30["active"]["stock_mix"]["style_status"] == "active"

    def test_echo_retired(self, payloads_30):
        assert payloads_30["retired"]["stock_mix"]["style_status"] == "retired"

    def test_default_is_all(self, headers):
        p = _fetch(headers, style_status=None, window_days=30)
        assert p["stock_mix"]["style_status"] == "all"

    def test_default_stock_matches_all(self, headers, payloads_30):
        p_default = _fetch(headers, style_status=None, window_days=30)
        assert (
            p_default["stock_mix"]["total_stock_units"]
            == payloads_30["all"]["stock_mix"]["total_stock_units"]
        )


class TestInventorySplitsByStyleStatus:
    """all ≈ active + retired for inventory totals; both > 0."""

    def test_all_equals_active_plus_retired(self, payloads_30):
        s_all = payloads_30["all"]["stock_mix"]["total_stock_units"]
        s_active = payloads_30["active"]["stock_mix"]["total_stock_units"]
        s_retired = payloads_30["retired"]["stock_mix"]["total_stock_units"]
        # Exact sum (style classification is partition over the inventory set).
        assert s_all == s_active + s_retired, (
            f"all={s_all} active={s_active} retired={s_retired} "
            f"(active+retired={s_active + s_retired})"
        )

    def test_active_and_retired_both_positive(self, payloads_30):
        s_active = payloads_30["active"]["stock_mix"]["total_stock_units"]
        s_retired = payloads_30["retired"]["stock_mix"]["total_stock_units"]
        assert s_active > 0
        assert s_retired > 0

    def test_active_strictly_less_than_all(self, payloads_30):
        s_all = payloads_30["all"]["stock_mix"]["total_stock_units"]
        s_active = payloads_30["active"]["stock_mix"]["total_stock_units"]
        assert s_active < s_all

    def test_retired_strictly_less_than_all(self, payloads_30):
        s_all = payloads_30["all"]["stock_mix"]["total_stock_units"]
        s_retired = payloads_30["retired"]["stock_mix"]["total_stock_units"]
        assert s_retired < s_all


class TestSalesUnfilteredByStyleStatus:
    """Sales (subcategory-sales aggregate) must NOT change with style_status."""

    def test_total_sold_units_mtd_identical(self, payloads_30):
        s_all = payloads_30["all"]["stock_mix"].get("total_sold_units_mtd")
        s_active = payloads_30["active"]["stock_mix"].get("total_sold_units_mtd")
        s_retired = payloads_30["retired"]["stock_mix"].get("total_sold_units_mtd")
        # All three should be identical (or all None — but smoke-tested non-zero)
        assert s_all == s_active == s_retired, (
            f"MTD sold should be unfiltered: all={s_all} "
            f"active={s_active} retired={s_retired}"
        )

    def test_total_sold_units_window_identical(self, payloads_30):
        s_all = payloads_30["all"]["stock_mix"].get("total_sold_units_window")
        s_active = payloads_30["active"]["stock_mix"].get("total_sold_units_window")
        s_retired = payloads_30["retired"]["stock_mix"].get("total_sold_units_window")
        assert s_all == s_active == s_retired


class TestStyleStatusCombinesWithWindowDays:
    """style_status filter is orthogonal to window_days."""

    def test_window_60_with_retired(self, headers):
        p = _fetch(headers, style_status="retired", window_days=60)
        sm = p["stock_mix"]
        assert sm["style_status"] == "retired"
        assert sm["window_days"] == 60

    def test_window_90_with_active(self, headers):
        p = _fetch(headers, style_status="active", window_days=90)
        sm = p["stock_mix"]
        assert sm["style_status"] == "active"
        assert sm["window_days"] == 90

    def test_retired_stock_constant_across_windows(self, headers):
        """Stock is point-in-time; should not vary with the sold window."""
        p30 = _fetch(headers, style_status="retired", window_days=30)
        p60 = _fetch(headers, style_status="retired", window_days=60)
        p90 = _fetch(headers, style_status="retired", window_days=90)
        assert (
            p30["stock_mix"]["total_stock_units"]
            == p60["stock_mix"]["total_stock_units"]
            == p90["stock_mix"]["total_stock_units"]
        )


class TestRegressionUnchanged:
    """Top-level non-stock-mix blocks remain unchanged across style_status."""

    def test_kpis_present_for_all_filters(self, payloads_30):
        for k, p in payloads_30.items():
            assert "ytd" in p, f"missing ytd in style={k}"
            assert "mtd" in p, f"missing mtd in style={k}"
            assert "kpis" in p["ytd"], f"missing ytd.kpis in style={k}"

    def test_country_block_unchanged(self, payloads_30):
        # Country / Targets / Category / Store sections should not be
        # affected by style_status (it only filters stock_mix inventory).
        a = payloads_30["all"].get("ytd", {}).get("kpis")
        b = payloads_30["retired"].get("ytd", {}).get("kpis")
        assert a == b, "YTD KPIs should not depend on style_status filter"
