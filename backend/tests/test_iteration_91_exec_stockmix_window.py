"""
Iter 91 — Backend regression tests for the Executive Summary "Stock Mix"
windowed sold/cover feature.

Verifies:
  - GET /api/exec-summary?window_days=30|60|90 returns the expected new
    `stock_mix` shape (window_days, weeks_in_window, sold_window,
    total_sold_units_window, per-category sold_units + weeks_of_cover).
  - 60d sold ≈ 2× 30d sold, 90d sold ≈ 3× 30d sold (approximate scaling).
  - Default `window_days` = 30 when omitted.
  - Invalid value (e.g. 15) falls back to 30.
"""
import os
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"
TIMEOUT = 120  # exec-summary cold path can be slow


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=60,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


def _fetch(window_days, headers):
    params = {} if window_days is None else {"window_days": window_days}
    r = requests.get(
        f"{BASE_URL}/api/exec-summary", params=params, headers=headers, timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"exec-summary {window_days} -> {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def payloads(headers):
    p30 = _fetch(30, headers)
    p60 = _fetch(60, headers)
    p90 = _fetch(90, headers)
    return {30: p30, 60: p60, 90: p90}


class TestStockMixShape:
    """Schema-level checks for the windowed stock_mix block."""

    def test_stock_mix_has_window_fields_30(self, payloads):
        sm = payloads[30]["stock_mix"]
        assert sm["window_days"] == 30
        assert abs(sm["weeks_in_window"] - (30 / 7.0)) < 1e-6
        assert "sold_window" in sm and {"from", "to", "days"}.issubset(sm["sold_window"].keys())
        assert sm["sold_window"]["days"] == 30
        assert "total_sold_units_window" in sm
        assert isinstance(sm["categories"], list) and len(sm["categories"]) > 0

    def test_stock_mix_has_window_fields_60(self, payloads):
        sm = payloads[60]["stock_mix"]
        assert sm["window_days"] == 60
        assert abs(sm["weeks_in_window"] - (60 / 7.0)) < 1e-6
        assert sm["sold_window"]["days"] == 60

    def test_stock_mix_has_window_fields_90(self, payloads):
        sm = payloads[90]["stock_mix"]
        assert sm["window_days"] == 90
        assert abs(sm["weeks_in_window"] - (90 / 7.0)) < 1e-6
        assert sm["sold_window"]["days"] == 90

    def test_category_rows_have_sold_units_and_woc(self, payloads):
        for wd, p in payloads.items():
            cats = p["stock_mix"]["categories"]
            assert len(cats) > 0, f"no categories at window_days={wd}"
            for row in cats:
                assert "sold_units" in row
                assert "stock_units" in row
                assert "weeks_of_cover" in row  # may be None for idle
                assert "subcategories" in row
                # spot-check sub rows
                for sub in row["subcategories"]:
                    assert "sold_units" in sub
                    assert "weeks_of_cover" in sub


class TestWindowScaling:
    """60d sold ≈ 2× 30d, 90d sold ≈ 3× 30d (approximate)."""

    def test_total_sold_scales_roughly_2x_60(self, payloads):
        s30 = payloads[30]["stock_mix"]["total_sold_units_window"]
        s60 = payloads[60]["stock_mix"]["total_sold_units_window"]
        assert s30 > 0 and s60 > 0
        ratio = s60 / s30
        assert 1.5 <= ratio <= 2.5, f"60d/30d ratio {ratio:.2f} out of expected band"

    def test_total_sold_scales_roughly_3x_90(self, payloads):
        s30 = payloads[30]["stock_mix"]["total_sold_units_window"]
        s90 = payloads[90]["stock_mix"]["total_sold_units_window"]
        assert s30 > 0 and s90 > 0
        ratio = s90 / s30
        assert 2.0 <= ratio <= 3.6, f"90d/30d ratio {ratio:.2f} out of expected band"

    def test_total_sold_strictly_increases_with_window(self, payloads):
        s30 = payloads[30]["stock_mix"]["total_sold_units_window"]
        s60 = payloads[60]["stock_mix"]["total_sold_units_window"]
        s90 = payloads[90]["stock_mix"]["total_sold_units_window"]
        assert s60 > s30
        assert s90 > s60

    def test_total_stock_units_constant_across_windows(self, payloads):
        # Stock is point-in-time; should not change with the sold window.
        s30 = payloads[30]["stock_mix"]["total_stock_units"]
        s60 = payloads[60]["stock_mix"]["total_stock_units"]
        s90 = payloads[90]["stock_mix"]["total_stock_units"]
        assert s30 == s60 == s90


class TestDefaultAndInvalid:
    """Default + invalid window_days handling."""

    def test_default_is_30(self, headers):
        p = _fetch(None, headers)
        assert p["stock_mix"]["window_days"] == 30

    def test_invalid_falls_back_to_30(self, headers):
        # 15 is not a supported preset → server should clamp to 30.
        p = _fetch(15, headers)
        assert p["stock_mix"]["window_days"] == 30

    def test_other_invalid_falls_back_to_30(self, headers):
        p = _fetch(120, headers)
        assert p["stock_mix"]["window_days"] == 30
