"""Iteration 39 — verify path-aware country normalization fix.

Bug context:
- Frontend lowercases country (`kenya`) before sending to backend.
- Upstream Vivo BI API has MIXED case-sensitivity:
    * /orders, /sales-summary, /daily-trend, /subcategory-sales,
      /subcategory-stock-sales — REQUIRE Title-case (Kenya).
    * /inventory — REQUIRES lowercase (kenya).
    * /locations, /country-summary, /kpis — case-insensitive.
- Fix added a path-aware normalization block in fetch():
  /inventory -> lowercase, otherwise -> Title-case.

Tests hit the public API from a fresh authenticated session, exactly as the
React Inventory page does (lowercase country values).
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PWD = "VivoAdmin!2026"

DATE_FROM = "2026-04-22"
DATE_TO = "2026-04-29"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    if not tok:
        pytest.skip("no token in login response")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _by_attr(s, country, locations=None):
    """Fetch by-attribute response. Returns dict with by_color and by_size lists."""
    p = {"country": country, "date_from": DATE_FROM, "date_to": DATE_TO, "limit": 12}
    if locations:
        p["locations"] = locations
    r = s.get(f"{BASE_URL}/api/analytics/stock-to-sales-by-attribute", params=p, timeout=180)
    assert r.status_code == 200, f"{country}: {r.status_code} {r.text[:200]}"
    j = r.json()
    assert "by_color" in j and "by_size" in j, f"unexpected shape: {list(j.keys())}"
    return j


def _sum(rows, key):
    return sum(float(r.get(key, 0) or 0) for r in rows)


# ---- Stock-to-Sales by Color ----
class TestSTSByColor:
    def test_kenya_units_and_stock_non_zero(self, auth_session):
        j = _by_attr(auth_session, "kenya")
        assert _sum(j["by_color"], "units_sold") > 0, f"by-color Kenya units_sold=0: {j['by_color'][:2]}"
        assert _sum(j["by_color"], "current_stock") > 0, f"by-color Kenya current_stock=0: {j['by_color'][:2]}"

    def test_uganda(self, auth_session):
        j = _by_attr(auth_session, "uganda")
        assert _sum(j["by_color"], "units_sold") > 0, "by-color Uganda units zero"
        assert _sum(j["by_color"], "current_stock") > 0, "by-color Uganda stock zero"

    def test_rwanda(self, auth_session):
        j = _by_attr(auth_session, "rwanda")
        assert _sum(j["by_color"], "units_sold") > 0, "by-color Rwanda units zero"
        assert _sum(j["by_color"], "current_stock") > 0, "by-color Rwanda stock zero"

    def test_online_units_populated_stock_zero_ok(self, auth_session):
        # Online has no warehouse → current_stock=0 is correct
        j = _by_attr(auth_session, "online")
        assert _sum(j["by_color"], "units_sold") > 0, f"by-color Online units zero: {j['by_color'][:2]}"
        # stock=0 is fine for online; do not assert > 0

    def test_kenya_multi_pos(self, auth_session):
        j = _by_attr(auth_session, "kenya", locations="Vivo Imaara,Vivo Westgate")
        assert _sum(j["by_color"], "units_sold") > 0, f"by-color Kenya 2-POS units zero: {j['by_color'][:2]}"
        assert _sum(j["by_color"], "current_stock") > 0, "by-color Kenya 2-POS stock zero"

    def test_multi_country_kenya_uganda(self, auth_session):
        j = _by_attr(auth_session, "kenya,uganda")
        assert _sum(j["by_color"], "units_sold") > 0, "by-color Kenya,Uganda units zero"
        assert _sum(j["by_color"], "current_stock") > 0, "by-color Kenya,Uganda stock zero"


# ---- Stock-to-Sales by Size ----
class TestSTSBySize:
    def test_kenya(self, auth_session):
        j = _by_attr(auth_session, "kenya")
        assert _sum(j["by_size"], "units_sold") > 0, f"by-size Kenya units zero: {j['by_size'][:2]}"
        assert _sum(j["by_size"], "current_stock") > 0, "by-size Kenya stock zero"

    def test_uganda(self, auth_session):
        j = _by_attr(auth_session, "uganda")
        assert _sum(j["by_size"], "units_sold") > 0
        assert _sum(j["by_size"], "current_stock") > 0

    def test_rwanda(self, auth_session):
        j = _by_attr(auth_session, "rwanda")
        assert _sum(j["by_size"], "units_sold") > 0
        assert _sum(j["by_size"], "current_stock") > 0

    def test_kenya_multi_pos(self, auth_session):
        j = _by_attr(auth_session, "kenya", locations="Vivo Imaara,Vivo Westgate")
        assert _sum(j["by_size"], "units_sold") > 0
        assert _sum(j["by_size"], "current_stock") > 0


# ---- Regression: subcategory + category still populated ----
class TestSTSRegression:
    def test_subcat_kenya(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/analytics/stock-to-sales-by-subcat",
            params={"country": "kenya", "date_from": DATE_FROM, "date_to": DATE_TO, "limit": 20},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("data") or [])
        assert _sum(rows, "units_sold") > 0, f"subcat Kenya units zero: {rows[:2]}"

    def test_category_kenya(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/analytics/stock-to-sales-by-category",
            params={"country": "kenya", "date_from": DATE_FROM, "date_to": DATE_TO, "limit": 20},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("data") or [])
        assert _sum(rows, "units_sold") > 0, f"category Kenya units zero: {rows[:2]}"


# ---- /inventory must still receive lowercase ----
class TestInventoryLowercase:
    def test_inventory_list_kenya(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/inventory",
            params={"country": "kenya", "page": 1, "limit": 25},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("items") or body.get("data") or [])
        assert isinstance(rows, list) and len(rows) > 0, f"/api/inventory empty under kenya: {body if not isinstance(body,list) else len(body)}"

    def test_inventory_summary_kenya(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/analytics/inventory-summary",
            params={"country": "kenya"},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # Find any positive numeric metric (stock_on_hand / total_stock / units)
        flat = body if isinstance(body, dict) else {}
        candidates = [
            flat.get("stock_on_hand"),
            flat.get("total_stock"),
            flat.get("units"),
            flat.get("total_units"),
            (flat.get("kpis") or {}).get("stock_on_hand") if isinstance(flat.get("kpis"), dict) else None,
        ]
        positive = any(_ is not None and float(_) > 0 for _ in candidates if _ is not None)
        # Fallback: any > 0 numeric value at top level
        if not positive:
            for v in flat.values():
                try:
                    if isinstance(v, (int, float)) and float(v) > 0:
                        positive = True
                        break
                except Exception:
                    pass
        assert positive, f"inventory-summary appears empty under kenya: {body}"


# ---- /kpis sanity (lowercase) ----
class TestKpisLowercase:
    def test_kpis_kenya_lowercase(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/kpis",
            params={"country": "kenya", "date_from": DATE_FROM, "date_to": DATE_TO},
            timeout=120,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        ns = body.get("net_sales") or body.get("netSales") or body.get("total_sales") or 0
        assert float(ns) > 0, f"/kpis net_sales zero under lowercase kenya: {body}"


# ---- /country-summary regression (Q2 card) ----
class TestCountrySummary:
    def test_q2_window(self, auth_session):
        r = auth_session.get(
            f"{BASE_URL}/api/country-summary",
            params={"date_from": "2026-04-01", "date_to": "2026-06-30"},
            timeout=120,
        )
        assert r.status_code == 200
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("data") or [])
        assert any(
            float((row.get("net_sales") or row.get("achieved") or row.get("total_sales") or 0)) > 0
            for row in rows
        ), f"country-summary all zero: {body}"
