"""
Iteration 41 — Backend tests for new analytics endpoints (Phases 2/3/4 of request).

Covers:
  - /api/analytics/customer-retention
  - /api/analytics/avg-spend-by-customer-type
  - /api/analytics/recently-unchurned
  - /api/analytics/aged-stock
  - /api/analytics/replenish-by-color
  - /api/analytics/style-sku-breakdown-bulk (performance bulk endpoint)
  - /api/analytics/customer-details
"""
import os
import sys
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback to frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")

# 2026-04-30 is "today" per the request; use MTD window
DATE_FROM = "2026-04-01"
DATE_TO = "2026-04-30"


@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@vivofashiongroup.com", "password": "VivoAdmin!2026"},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text[:200]}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# -- Phase 2.5 Customer Retention --
def test_customer_retention(h):
    r = requests.get(
        f"{BASE_URL}/api/analytics/customer-retention",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    # should exclude walk-ins (no customer_id) — rate should be meaningfully > 0
    # Keys we expect (flexible)
    keys = set(d.keys())
    print(f"retention keys={keys}")
    # Must include identified customer data
    assert "rate" in d or "repeat_rate" in d or "retention_rate" in d or "repeat_rate_pct" in d, f"Missing rate key: {keys}"
    rate = d.get("rate") or d.get("repeat_rate") or d.get("retention_rate") or d.get("repeat_rate_pct")
    assert rate is not None
    # Per request: MTD should be ~55% (identified only), NOT ~6% (which is all-orders incl walk-ins)
    rate_val = float(rate)
    if rate_val <= 1.0:
        rate_val = rate_val * 100
    print(f"retention rate_pct={rate_val}")
    assert rate_val > 20, f"Rate {rate_val}% looks like walk-ins-included bug (expected ~55%)"


# -- Phase 2.6 Avg Spend by Customer Type --
def test_avg_spend_by_customer_type(h):
    r = requests.get(
        f"{BASE_URL}/api/analytics/avg-spend-by-customer-type",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    print(f"avg_spend keys={list(d.keys())[:10]}")
    # Expect new + returning bucket
    joined = str(d).lower()
    assert "new" in joined and ("return" in joined or "repeat" in joined)
    # Extract numeric values
    def _find_num(obj):
        nums = []
        if isinstance(obj, dict):
            for v in obj.values():
                nums.extend(_find_num(v))
        elif isinstance(obj, list):
            for v in obj:
                nums.extend(_find_num(v))
        elif isinstance(obj, (int, float)):
            nums.append(obj)
        return nums
    nums = _find_num(d)
    assert any(n > 0 for n in nums), f"All-zero response: {d}"


# -- Phase 2.7 Recently Unchurned --
@pytest.mark.parametrize("days", [30, 60, 90, 180])
def test_recently_unchurned(h, days):
    # Retry once on 502 (known transient upstream rate-limit)
    last = None
    for _ in range(2):
        r = requests.get(
            f"{BASE_URL}/api/analytics/recently-unchurned",
            params={"date_from": DATE_FROM, "date_to": DATE_TO, "days": days},
            headers=h,
            timeout=240,
        )
        last = r
        if r.status_code == 200:
            break
    r = last
    assert r.status_code == 200, f"{days}d -> {r.status_code}: {r.text[:200]}"
    d = r.json()
    # Accept list or {items: [...]}
    items = d if isinstance(d, list) else (d.get("items") or d.get("customers") or d.get("data") or [])
    print(f"unchurned days={days} count={len(items)}")
    # Shape check on first item if any
    if items:
        sample = items[0]
        assert isinstance(sample, dict)


# -- Phase 3.8 Aged Stock --
def test_aged_stock(h):
    r = requests.get(
        f"{BASE_URL}/api/analytics/aged-stock",
        params={"days": 90},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    items = d if isinstance(d, list) else (d.get("items") or d.get("rows") or d.get("data") or [])
    print(f"aged_stock count={len(items)}")
    assert len(items) > 0, "Expected some aged stock rows"
    sample = items[0]
    # Expected fields per request
    keys = set(k.lower() for k in sample.keys())
    for field in ("days_since_last_sale", "soh"):
        assert any(field in k for k in keys), f"Missing {field} in {keys}"


# -- Phase 3.9 Replenish by Color --
def test_replenish_by_color(h):
    r = requests.get(
        f"{BASE_URL}/api/analytics/replenish-by-color",
        params={"woc_threshold": 8, "sor_threshold": 50},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    items = d if isinstance(d, list) else (d.get("items") or d.get("rows") or d.get("data") or [])
    print(f"replenish count={len(items)}")
    assert len(items) > 0, "Expected replenish rows"
    sample = items[0]
    sk = set(k.lower() for k in sample.keys())
    # Should have per-color breakdown
    assert any("color" in k for k in sk), f"Missing color breakdown in {sk}"


# -- Phase 3.10 Bulk SKU Breakdown (perf) --
def test_style_sku_breakdown_bulk(h):
    # Fetch style names from stock-to-sales (SOR endpoint)
    s = requests.get(
        f"{BASE_URL}/api/stock-to-sales",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=h,
        timeout=240,
    )
    styles = []
    if s.status_code == 200:
        rows = s.json()
        if isinstance(rows, dict):
            rows = rows.get("rows") or rows.get("items") or rows.get("data") or []
        for row in rows[:5]:
            if isinstance(row, dict):
                nm = row.get("style_name") or row.get("style") or row.get("name")
                if nm:
                    styles.append(nm)
    if not styles:
        pytest.skip(f"Could not fetch style names (status {s.status_code})")

    print(f"bulk test styles ({len(styles)})={styles[:3]}")
    r = requests.get(
        f"{BASE_URL}/api/analytics/style-sku-breakdown-bulk",
        params={"style_names": ",".join(styles)},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    d = r.json()
    assert "styles" in d, f"Missing 'styles' key in {list(d.keys())}"
    print(f"bulk returned styles={list(d['styles'].keys())[:3]} missing={len(d.get('missing', []))}")
    # At least one style should have data
    assert len(d["styles"]) >= 1


# -- Phase 4.11 Customer Details --
def test_customer_details(h):
    r = requests.get(
        f"{BASE_URL}/api/analytics/customer-details",
        params={"date_from": DATE_FROM, "date_to": DATE_TO, "page": 1, "limit": 25},
        headers=h,
        timeout=240,
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    items = d if isinstance(d, list) else (d.get("items") or d.get("rows") or d.get("data") or d.get("customers") or [])
    print(f"customer_details count={len(items)}")
    assert len(items) > 0, "Expected customer rows"
    sample = items[0]
    sk = set(k.lower() for k in sample.keys())
    # Required fields
    for f in ("first_name", "last_name"):
        assert f in sk, f"Missing {f} in {sk}"
    # SMS/email opt-in should be present (even if 'n/a')
    has_optin = any("sms" in k or "opt" in k for k in sk)
    assert has_optin, f"Missing sms/opt-in column in {sk}"
