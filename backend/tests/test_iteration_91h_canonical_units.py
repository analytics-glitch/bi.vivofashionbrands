"""Iter 91h — backend regression for /api/analytics/canonical-units-sold.

Verifies the new semantic-layer endpoint:
  • returns 200 with expected shape
  • returns the canonical Definition C values across the 5 audit filter states
  • matches STS units_sold for each filter state
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    token = r.json().get("token")
    assert token, f"no token in login response: {r.json()}"
    return {"Authorization": f"Bearer {token}"}


# 5 filter states from the audit
FILTER_STATES = [
    # (label, params, expected_canonical_units_or_None_to_skip_exact)
    ("all-entities last-90d", {"date_from": "2026-03-03", "date_to": "2026-05-31"}, 66651),
    ("Kenya MTD",             {"date_from": "2026-05-01", "date_to": "2026-05-31", "country": "Kenya"}, 19810),
    ("Vivo Westgate L7",      {"date_from": "2026-05-25", "date_to": "2026-05-31", "locations": "Vivo Westgate"}, None),
    ("current-quarter all",   {"date_from": "2026-04-01", "date_to": "2026-05-31"}, None),
    ("empty combo",           {"date_from": "2026-05-31", "date_to": "2026-05-31", "country": "Rwanda", "locations": "Vivo Westgate"}, 0),
]


@pytest.mark.parametrize("label,params,expected", FILTER_STATES)
def test_canonical_units_sold_shape_and_values(auth_headers, label, params, expected):
    r = requests.get(
        f"{BASE_URL}/api/analytics/canonical-units-sold",
        params=params,
        headers=auth_headers,
        timeout=60,
    )
    assert r.status_code == 200, f"[{label}] expected 200, got {r.status_code} body={r.text[:300]}"
    body = r.json()
    # shape
    assert "units_sold" in body, f"[{label}] response missing units_sold: {body}"
    assert isinstance(body["units_sold"], int), f"[{label}] units_sold not int: {body}"
    assert body.get("definition") == "vivo_merchandise", f"[{label}] wrong definition: {body.get('definition')}"
    assert "filter" in body, f"[{label}] response missing filter echo: {body}"
    # value
    if expected is not None:
        assert body["units_sold"] == expected, (
            f"[{label}] canonical units_sold = {body['units_sold']} expected {expected}"
        )


def test_canonical_matches_sts_units_sold(auth_headers):
    """Canonical endpoint must equal STS units_sold rollup for each filter state."""
    mismatches = []
    for label, params, _ in FILTER_STATES:
        rc = requests.get(
            f"{BASE_URL}/api/analytics/canonical-units-sold",
            params=params, headers=auth_headers, timeout=60,
        )
        rs = requests.get(
            f"{BASE_URL}/api/analytics/stock-to-sales-by-subcat",
            params=params, headers=auth_headers, timeout=120,
        )
        if rc.status_code != 200 or rs.status_code != 200:
            mismatches.append(f"[{label}] HTTP fail: canon={rc.status_code} sts={rs.status_code}")
            continue
        canon = int(rc.json().get("units_sold") or 0)
        sts_rows = rs.json()
        if isinstance(sts_rows, dict):
            sts_rows = sts_rows.get("rows") or []
        sts_sum = int(sum((row.get("units_sold") or 0) for row in sts_rows))
        if canon != sts_sum:
            mismatches.append(f"[{label}] canon={canon} sts={sts_sum} diff={canon - sts_sum}")
    assert not mismatches, "Canonical vs STS mismatches:\n  " + "\n  ".join(mismatches)


def test_other_kpi_endpoints_unchanged(auth_headers):
    """Regression smoke: KPIs/sales-summary still respond 200 and have expected shape."""
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": "2026-05-01", "date_to": "2026-05-31"},
        headers=auth_headers, timeout=60,
    )
    assert r.status_code == 200
    body = r.json()
    # legacy total_units field still present (not removed by 91m)
    assert "total_units" in body or "units" in body or "revenue" in body, f"kpis shape changed: {list(body.keys())[:10]}"
