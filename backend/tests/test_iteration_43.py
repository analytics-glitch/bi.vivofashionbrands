"""Iteration 43 - tests for 4 changes:
1. Repeat-customer order rule (visit = (date, channel))
2. Annual Targets endpoint
3. SOR Report extra fields (category, original_price)
4. Walk-in detector hardening
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
TIMEOUT = 90


@pytest.fixture(scope="session")
def headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@vivofashiongroup.com", "password": "VivoAdmin!2026"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_annual_targets(headers):
    r = requests.get(f"{BASE_URL}/api/analytics/annual-targets", headers=headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "buckets" in data and "total" in data
    assert len(data["buckets"]) == 4
    names = {b.get("name") or b.get("bucket") or b.get("label") for b in data["buckets"]}
    assert names == {"Kenya - Retail", "Kenya - Online", "Uganda", "Rwanda"}, f"buckets={names}"
    total_target = data["total"]["target_annual"]
    assert abs(total_target - 1434521673) <= 1, f"total_target={total_target}"
    for b in data["buckets"]:
        for f in ("target_annual", "actual_ytd", "actual_quarters", "projected_year",
                  "pct_of_target_ytd", "pct_of_target_projected", "variance_projected", "quarters"):
            assert f in b, f"missing {f}"
        for q in ("Q1", "Q2", "Q3", "Q4"):
            assert q in b["quarters"]


def test_sor_all_styles(headers):
    r = requests.get(f"{BASE_URL}/api/analytics/sor-all-styles", headers=headers, timeout=TIMEOUT)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) > 1000, f"only {len(rows)} rows"
    s = rows[0]
    assert "category" in s, list(s.keys())
    assert "original_price" in s, list(s.keys())
    # also verify other key fields present (with backend's actual naming)
    for f in ("style_name", "style_number", "soh_total", "soh_wh", "pct_in_wh",
              "asp_6m", "sales_6m", "units_6m", "units_3w", "days_since_last_sale",
              "sor_6m", "launch_date", "weekly_avg", "woc", "style_age_weeks"):
        assert f in s, f"missing {f} in {list(s.keys())}"


def test_repeat_customers(headers):
    r = requests.get(
        f"{BASE_URL}/api/analytics/repeat-customers",
        params={"date_from": "2026-04-27", "date_to": "2026-05-04"},
        headers=headers, timeout=TIMEOUT,
    )
    assert r.status_code == 200
    customers = r.json()
    assert isinstance(customers, list)
    n = len(customers)
    assert abs(n - 176) <= 5, f"got {n} customers, expected ~176"
    # verify visit-style orders
    for c in customers[:20]:
        assert "orders" in c
        for o in c["orders"]:
            assert "order_date" in o and "channel" in o
            assert "order_id" in o
            assert o.get("order_id_count", 1) >= 1
    # find a comma-joined order_id (multiple orders per visit)
    found_multi = False
    for c in customers:
        for o in c.get("orders", []):
            if o.get("order_id_count", 0) >= 2:
                assert "," in o["order_id"]
                found_multi = True
                break
        if found_multi:
            break
    assert found_multi, "Expected at least one visit with merged order_ids"


def test_customer_frequency(headers):
    r = requests.get(
        f"{BASE_URL}/api/customer-frequency",
        params={"date_from": "2026-04-27", "date_to": "2026-05-04"},
        headers=headers, timeout=TIMEOUT,
    )
    assert r.status_code == 200
    buckets = r.json()
    assert isinstance(buckets, list)
    assert len(buckets) == 5
    total = sum(b.get("customer_count", 0) for b in buckets)
    assert abs(total - 2032) <= 50, f"total customers={total}"
    one = next(b for b in buckets if b["frequency_bucket"].startswith("1"))
    assert abs(one["customer_count"] - 1856) <= 50, one


def test_retention_matches_frequency(headers):
    rf = requests.get(f"{BASE_URL}/api/customer-frequency",
                      params={"date_from": "2026-04-27", "date_to": "2026-05-04"},
                      headers=headers, timeout=TIMEOUT)
    rr = requests.get(f"{BASE_URL}/api/analytics/customer-retention",
                      params={"date_from": "2026-04-27", "date_to": "2026-05-04"},
                      headers=headers, timeout=TIMEOUT)
    assert rf.status_code == 200 and rr.status_code == 200
    buckets = rf.json()
    total = sum(b["customer_count"] for b in buckets)
    one = next(b for b in buckets if b["frequency_bucket"].startswith("1"))["customer_count"]
    expected_repeat = total - one
    rdata = rr.json()
    repeat = rdata.get("repeat_customers") or rdata.get("repeat") or rdata.get("repeat_count")
    assert repeat is not None, f"no repeat_customers in {list(rdata.keys())}"
    assert abs(repeat - expected_repeat) <= 2, f"retention.repeat={repeat} vs freq-derived={expected_repeat}"
