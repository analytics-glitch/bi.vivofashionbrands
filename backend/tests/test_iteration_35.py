"""Iteration 35 backend tests.

Covers:
  - GET /api/analytics/sor-all-styles (NEW): catalog-wide style-level SOR
  - GET /api/analytics/style-sku-breakdown (NEW): per-SKU drill-down
  - GET /api/analytics/sor-new-styles-l10 regression: style names not duplicated
  - Auth guards on both new endpoints
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


# ---- Expected column shape for L-10 + All Styles -----------------------
EXPECTED_KEYS = {
    "style_name", "subcategory", "units_6m", "units_3w",
    "sales_6m", "soh_total", "soh_wh", "soh_store",
    "sor_6m", "pct_in_wh", "woc",
}


# ---- /api/analytics/sor-all-styles -------------------------------------

class TestSorAllStyles:
    def test_returns_list_with_expected_columns(self, auth_headers):
        t0 = time.time()
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-all-styles",
            headers=auth_headers,
            timeout=240,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        assert isinstance(data, list), "expected JSON array"
        assert len(data) > 0, "expected at least one style row"
        row = data[0]
        # All expected keys present (column shape parity with L-10)
        missing = EXPECTED_KEYS - set(row.keys())
        assert not missing, f"missing keys on row: {missing}; row={row}"
        # Style name distinctness — bug from earlier session
        names = [r.get("style_name") for r in data]
        assert len(set(names)) == len(names), (
            f"duplicate style_name in sor-all-styles: "
            f"{len(names)} rows but {len(set(names))} unique"
        )
        print(f"[sor-all-styles] {len(data)} rows in {elapsed:.1f}s")

    def test_with_country_channel_brand_filters(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-all-styles",
            params={"country": "Kenya", "channel": "Retail", "brand": "Vivo"},
            headers=auth_headers,
            timeout=240,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, list)
        # Shape sanity on filtered rows too
        if data:
            row = data[0]
            assert EXPECTED_KEYS - set(row.keys()) == set()

    def test_unauth(self):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-all-styles", timeout=10
        )
        assert r.status_code in (401, 403)


# ---- /api/analytics/style-sku-breakdown --------------------------------

class TestStyleSkuBreakdown:
    @pytest.fixture(scope="class")
    def style_name(self, auth_headers):
        """Pick a real style_name from L-10 (faster than warming All-Styles)."""
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-new-styles-l10",
            headers={"Authorization": auth_headers["Authorization"]},
            timeout=240,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert rows, "no L-10 rows to drive breakdown test"
        # Prefer a row with units_6m>0 to ensure SKUs exist
        for x in rows:
            if x.get("units_6m", 0) > 0 and x.get("style_name"):
                return x["style_name"]
        return rows[0]["style_name"]

    def test_breakdown_shape(self, auth_headers, style_name):
        r = requests.get(
            f"{BASE_URL}/api/analytics/style-sku-breakdown",
            params={"style_name": style_name},
            headers=auth_headers,
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data.get("style_name") == style_name
        assert "skus" in data and isinstance(data["skus"], list)
        assert len(data["skus"]) > 0, "expected at least one SKU"
        sku = data["skus"][0]
        for k in ("sku", "color", "size", "units_6m", "units_3w",
                  "sales_6m", "soh_total", "soh_store", "soh_wh"):
            assert k in sku, f"sku row missing {k}: {sku}"

    def test_unauth(self):
        r = requests.get(
            f"{BASE_URL}/api/analytics/style-sku-breakdown",
            params={"style_name": "X"},
            timeout=10,
        )
        assert r.status_code in (401, 403)


# ---- /api/analytics/sor-new-styles-l10 regression ----------------------

class TestL10Regression:
    def test_l10_style_names_not_duplicated(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sor-new-styles-l10",
            headers=auth_headers,
            timeout=240,
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list) and rows, "L-10 must return rows"
        names = [r.get("style_name") for r in rows]
        # No empty/None
        assert all(n for n in names), "L-10 contains empty style_name"
        # Distinctness — bug fixed in earlier session
        assert len(set(names)) == len(names), (
            f"L-10 has duplicates: {len(names)} rows / {len(set(names))} unique"
        )
        # Column shape parity check
        row = rows[0]
        missing = EXPECTED_KEYS - set(row.keys())
        assert not missing, f"L-10 missing keys: {missing}"
        # launch_date column should be present on L-10 (per FE showLaunchDate=true)
        assert "launch_date" in row, "L-10 row missing launch_date"
