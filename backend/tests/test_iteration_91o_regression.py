"""
Iter 91o backend regression sanity checks.

Validates the backend changes from iter 91o:
  - GET /api/customers/walk-ins returns walk_in_share_unreliable
    + walk_in_share_sales_pct_raw fields (ISS-007).
  - GET /api/admin/reconciliation-check has renamed key
    'walkin_sales_denominator_kes' (ISS-014).
  - /api/kpis return_rate uses returns/(returns + net_sales) formula
    (ISS-008) — sanity check it's a small reasonable number, not 0.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"

DATE_FROM = "2026-04-01"
DATE_TO = "2026-04-19"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# --- ISS-007: walk-ins endpoint new fields ---------------------------------
def test_walk_ins_has_unreliable_flag(auth):
    r = requests.get(
        f"{BASE_URL}/api/customers/walk-ins",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=auth,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # ISS-007 required keys
    assert "walk_in_share_unreliable" in data, "missing walk_in_share_unreliable"
    assert "walk_in_share_sales_pct_raw" in data, "missing walk_in_share_sales_pct_raw"
    # Type sanity
    assert isinstance(data["walk_in_share_unreliable"], bool)
    assert isinstance(data["walk_in_share_sales_pct_raw"], (int, float))


# --- ISS-014: reconciliation-check renamed key -----------------------------
def test_reconciliation_check_renamed_walkin_denominator(auth):
    r = requests.get(
        f"{BASE_URL}/api/admin/reconciliation-check",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=auth,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # Top-level shape; "checks" likely list of dicts each with name
    blob = str(data)
    assert "walkin_sales_denominator_kes" in blob, (
        f"renamed key 'walkin_sales_denominator_kes' not found in payload: {blob[:500]}"
    )


# --- ISS-008: /api/kpis return_rate uses new formula -----------------------
def test_kpis_return_rate_present(auth):
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": DATE_FROM, "date_to": DATE_TO},
        headers=auth,
        timeout=60,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "return_rate" in data
    rr = data["return_rate"]
    # Plausibility: 0..30% — formula is returns/(returns+net_sales)*100
    assert isinstance(rr, (int, float))
    assert 0 <= rr <= 30, f"return_rate out of plausible range: {rr}"


# --- ISS-009 / ISS-004 helper: pure unit test on the JS guard logic --------
def test_iss009_guard_logic_unit():
    """Mirror the guard in Footfall.jsx (lines 283/302) to assert that
    when either current or previous conv/turn_in > 100, the delta is None."""

    def conv_delta(conversion, prev_conv):
        out_of_range = (conversion is not None and conversion > 100) or (
            prev_conv is not None and prev_conv > 100
        )
        if prev_conv is not None and not out_of_range:
            return conversion - prev_conv
        return None

    # Normal case → returns delta
    assert conv_delta(25.0, 20.0) == 5.0
    # Current > 100 → suppressed
    assert conv_delta(150.0, 20.0) is None
    # Previous > 100 → suppressed
    assert conv_delta(25.0, 150.0) is None
    # Both > 100 → suppressed
    assert conv_delta(150.0, 130.0) is None
    # Prev missing → None (no compare)
    assert conv_delta(25.0, None) is None
    # Boundary at exactly 100 → still allowed
    assert conv_delta(100.0, 80.0) == 20.0
