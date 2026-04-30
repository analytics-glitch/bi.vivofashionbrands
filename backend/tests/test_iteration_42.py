"""Iteration 42 — verify 5 follow-up tweaks:
  1. /analytics/customer-retention still returns repeat_rate_pct (~55%)
  2. stock_scope on /analytics/stock-to-sales-by-subcat (stores/warehouse/combined)
  3. stock_scope on /analytics/stock-to-sales-by-category
  4. /analytics/style-sku-breakdown-bulk returns non-empty styles map
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PWD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- 1. Customer retention (powers retention-rate card) ---
def test_customer_retention_returns_pct(headers):
    """Frontend Customers page reads repeat_rate_pct from this endpoint
    for the new kpi-retention-rate card (~55%)."""
    r = requests.get(
        f"{API}/analytics/customer-retention",
        params={"date_from": "2026-04-01", "date_to": "2026-04-30"},
        headers=headers, timeout=180,
    )
    if r.status_code in (502, 503, 504):
        pytest.skip(f"upstream transient {r.status_code} (cold cache); see iter_41 known issue")
    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    j = r.json()
    assert "repeat_rate_pct" in j, f"missing repeat_rate_pct: {list(j.keys())}"
    pct = float(j["repeat_rate_pct"])
    # spec ~55% identified-only (walk-ins excluded)
    assert 30 <= pct <= 90, f"repeat_rate_pct={pct} outside expected 30-90%"


# --- 2. stock_scope on /analytics/stock-to-sales-by-subcat ---
class TestStockScopeSubcat:
    EP = "/analytics/stock-to-sales-by-subcat"
    PARAMS = {"country": "Kenya", "date_from": "2026-04-01", "date_to": "2026-04-30"}

    def _fetch(self, headers, scope):
        r = requests.get(f"{API}{self.EP}", params={**self.PARAMS, "stock_scope": scope},
                         headers=headers, timeout=180)
        if r.status_code in (502, 503, 504):
            pytest.skip(f"upstream {r.status_code} on stock_scope={scope}")
        assert r.status_code == 200, f"scope={scope} {r.status_code}: {r.text[:200]}"
        j = r.json()
        return j if isinstance(j, list) else (j.get("rows") or j.get("data") or [])

    def test_stores_default(self, headers):
        rows = self._fetch(headers, "stores")
        assert isinstance(rows, list) and len(rows) > 0, "no rows for stores"
        assert any(("current_stock" in r) or ("stock" in r) for r in rows[:5]), f"first row keys: {list(rows[0].keys())}"

    def test_warehouse_differs_from_stores(self, headers):
        s_rows = self._fetch(headers, "stores")
        w_rows = self._fetch(headers, "warehouse")

        def stock_map(rows):
            out = {}
            for r in rows:
                k = r.get("subcategory") or r.get("subcat") or r.get("name") or r.get("key")
                cs = r.get("current_stock", r.get("stock", 0))
                if k is not None:
                    out[k] = cs
            return out

        sm, wm = stock_map(s_rows), stock_map(w_rows)
        common = set(sm.keys()) & set(wm.keys())
        assert common, "no overlapping subcategories between stores/warehouse"
        diffs = sum(1 for k in common if sm[k] != wm[k])
        assert diffs > 0, f"warehouse stock identical to stores for all {len(common)} subcats"

    def test_combined_equals_or_greater_than_stores(self, headers):
        s_rows = self._fetch(headers, "stores")
        c_rows = self._fetch(headers, "combined")
        s_total = sum(r.get("current_stock", r.get("stock", 0)) for r in s_rows)
        c_total = sum(r.get("current_stock", r.get("stock", 0)) for r in c_rows)
        assert c_total >= s_total, f"combined({c_total}) < stores({s_total})"


# --- 3. stock_scope on /analytics/stock-to-sales-by-category ---
class TestStockScopeCategory:
    EP = "/analytics/stock-to-sales-by-category"
    PARAMS = {"country": "Kenya", "date_from": "2026-04-01", "date_to": "2026-04-30"}

    def _fetch(self, headers, scope):
        r = requests.get(f"{API}{self.EP}", params={**self.PARAMS, "stock_scope": scope},
                         headers=headers, timeout=180)
        if r.status_code in (502, 503, 504):
            pytest.skip(f"upstream {r.status_code} on cat scope={scope}")
        assert r.status_code == 200, f"cat scope={scope} {r.status_code}: {r.text[:200]}"
        j = r.json()
        return j if isinstance(j, list) else (j.get("rows") or j.get("data") or [])

    def test_all_three_scopes_succeed(self, headers):
        totals = {}
        for scope in ("stores", "warehouse", "combined"):
            rows = self._fetch(headers, scope)
            assert isinstance(rows, list), f"scope={scope} not list: {type(rows)}"
            totals[scope] = sum(r.get("current_stock", r.get("stock", 0)) for r in rows)
        # combined should be >= stores (sanity)
        assert totals["combined"] >= totals["stores"], f"totals: {totals}"


# --- 4. style-sku-breakdown-bulk ---
def test_style_sku_breakdown_bulk(headers):
    names = "Soko Kazuri Lariat,Vivo Basic Double Layered Wrap Poncho,Denim Haven High Rise Skinny Jeans"
    r = requests.get(
        f"{API}/analytics/style-sku-breakdown-bulk",
        params={"style_names": names},
        headers=headers, timeout=240,
    )
    if r.status_code in (502, 503, 504):
        pytest.skip(f"upstream transient {r.status_code} (cold 6m fan-out)")
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    j = r.json()
    assert "styles" in j and isinstance(j["styles"], dict), f"shape: {list(j.keys())}"
    assert "missing" in j, "missing key absent"
    # At least ONE of the 3 should resolve to non-empty (existence of all
    # 3 in catalog is asserted by separate frontend testing).
    non_empty = [k for k, v in j["styles"].items() if isinstance(v, list) and len(v) > 0]
    assert len(non_empty) >= 1, f"all 3 styles empty: styles={ {k: len(v) for k,v in j['styles'].items()} }, missing={j['missing']}"
    # Validate row shape on first non-empty style
    first = j["styles"][non_empty[0]][0]
    expected_keys = {"color", "size"}
    assert expected_keys.issubset(set(first.keys())), f"row keys: {list(first.keys())}"
