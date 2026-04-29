"""
Iteration 38 — verifies:
(A) Inventory STS endpoints respect POS-location filter when computing units_sold
    from /orders aggregation (regression fix for upstream API silently dropping sales
    when channel=<POS> is set).
(B) /country-summary returns expected per-country aggregates for fixed Q2 window
    (Apr 1 – Jun 30 2026), which Q2TargetsCard relies on.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"

Q2_FROM = "2026-04-01"
Q2_TO = "2026-06-30"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=120,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    t = r.json().get("token")
    assert t
    return t


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ----------- (A) Inventory STS regression: POS-filtered units_sold ----------

def _sum_units(rows):
    return sum(int(r.get("units_sold") or 0) for r in rows)


def test_sts_subcat_no_locations_has_units(auth):
    """Baseline: no POS filter → units_sold should be > 0."""
    r = requests.get(
        f"{BASE_URL}/api/analytics/stock-to-sales-by-subcat",
        params={"date_from": Q2_FROM, "date_to": "2026-04-29"},
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("data", [])
    assert len(rows) > 0, "expected non-empty rows"
    assert _sum_units(rows) > 0, f"expected non-zero total units_sold, got {_sum_units(rows)}"


def test_sts_subcat_with_kenya_pos_locations(auth):
    """REGRESSION: with two Kenya POS locations, units_sold must be > 0
    (previously upstream dropped channel=<POS> sales)."""
    r = requests.get(
        f"{BASE_URL}/api/analytics/stock-to-sales-by-subcat",
        params={
            "date_from": Q2_FROM, "date_to": "2026-04-29",
            "country": "Kenya",
            "locations": "Vivo Imaara,Vivo Westgate",
        },
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("data", [])
    assert len(rows) > 0, "expected non-empty rows for POS-filtered subcat STS"
    total = _sum_units(rows)
    assert total > 0, f"REGRESSION: expected non-zero units_sold under POS filter, got {total}"
    nonzero_rows = [r for r in rows if int(r.get("units_sold") or 0) > 0]
    assert len(nonzero_rows) >= 1, "expected at least one subcat row with units_sold > 0"


def test_sts_category_with_kenya_pos_locations(auth):
    r = requests.get(
        f"{BASE_URL}/api/analytics/stock-to-sales-by-category",
        params={
            "date_from": Q2_FROM, "date_to": "2026-04-29",
            "country": "Kenya",
            "locations": "Vivo Imaara,Vivo Westgate",
        },
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("data", [])
    assert len(rows) > 0
    total = _sum_units(rows)
    assert total > 0, f"REGRESSION: expected non-zero units_sold for by-category under POS filter, got {total}"


def test_sts_attribute_color_size_with_kenya_pos_locations(auth):
    """by-attribute returns {by_color: [...], by_size: [...]} — both should be non-zero
    under POS filter."""
    r = requests.get(
        f"{BASE_URL}/api/analytics/stock-to-sales-by-attribute",
        params={
            "date_from": Q2_FROM, "date_to": "2026-04-29",
            "country": "Kenya",
            "locations": "Vivo Imaara,Vivo Westgate",
        },
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    by_color = payload.get("by_color") or []
    by_size = payload.get("by_size") or []
    assert len(by_color) > 0, "expected non-empty by_color rows"
    assert len(by_size) > 0, "expected non-empty by_size rows"
    assert _sum_units(by_color) > 0, "expected non-zero units_sold for by_color under POS filter"
    assert _sum_units(by_size) > 0, "expected non-zero units_sold for by_size under POS filter"


def test_sts_subcat_single_kenya_pos(auth):
    """Same regression but with a single POS location."""
    r = requests.get(
        f"{BASE_URL}/api/analytics/stock-to-sales-by-subcat",
        params={
            "date_from": Q2_FROM, "date_to": "2026-04-29",
            "country": "Kenya",
            "locations": "Vivo Imaara",
        },
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("data", [])
    assert len(rows) > 0
    assert _sum_units(rows) > 0, "expected non-zero units_sold for single-POS subcat STS"


# ----------- (B) Q2 Targets data source: /country-summary ----------

def test_country_summary_q2_window(auth):
    """Q2TargetsCard fetches /country-summary with fixed Q2 window."""
    r = requests.get(
        f"{BASE_URL}/api/country-summary",
        params={"date_from": Q2_FROM, "date_to": Q2_TO},
        headers=auth, timeout=180,
    )
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("data", [])
    assert isinstance(rows, list) and len(rows) > 0, "expected country rows"
    by_country = {row.get("country"): row for row in rows}
    # We expect at least Kenya present with non-zero total_sales.
    assert "Kenya" in by_country, f"countries returned: {list(by_country)}"
    kenya_sales = float(by_country["Kenya"].get("total_sales") or 0)
    assert kenya_sales > 0, f"expected Kenya total_sales > 0 for Q2 window, got {kenya_sales}"
    # Kenya target is 269M; achieved should be a small fraction of that this early in Q2.
    assert kenya_sales < 269_000_000, "Kenya achieved suspiciously >= 269M target"
