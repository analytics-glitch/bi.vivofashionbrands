"""Iteration 47 — SOR Report enhancements
- New fields units_since_launch, sor_since_launch on /api/analytics/sor-all-styles
- /products endpoint should not be called by the lifetime fan-out (uses /top-skus)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- /api/analytics/sor-all-styles ---
def test_sor_all_styles_returns_lifetime_fields(headers):
    """Validates new units_since_launch + sor_since_launch fields are present."""
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/analytics/sor-all-styles", headers=headers, timeout=180)
    elapsed = time.time() - t0
    print(f"sor-all-styles status={r.status_code} elapsed={elapsed:.1f}s")
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0, "expected non-empty list of styles"

    # Check first 5 rows for required new fields + types
    sample = data[:5]
    for row in sample:
        assert "units_since_launch" in row, f"missing units_since_launch in {row.get('style_name')}"
        assert "sor_since_launch" in row, f"missing sor_since_launch in {row.get('style_name')}"
        assert isinstance(row["units_since_launch"], int), \
            f"units_since_launch should be int, got {type(row['units_since_launch'])}"
        assert isinstance(row["sor_since_launch"], (int, float)), \
            f"sor_since_launch should be number, got {type(row['sor_since_launch'])}"
        # sor_since_launch should be a percentage between 0 and 100
        assert 0 <= row["sor_since_launch"] <= 100, \
            f"sor_since_launch out of range for {row.get('style_name')}: {row['sor_since_launch']}"
        # units_since_launch must be >= units_6m (lifetime >= 6m)
        assert row["units_since_launch"] >= row.get("units_6m", 0), \
            f"units_since_launch ({row['units_since_launch']}) < units_6m ({row.get('units_6m')}) for {row.get('style_name')}"

    # Existing required fields still present
    keys = set(sample[0].keys())
    for k in ["style_name", "sales_6m", "units_6m", "soh_total", "sor_6m"]:
        assert k in keys, f"missing existing field {k}"


def test_sor_all_styles_warm_cache_fast(headers):
    """Second call must hit cache and return quickly."""
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/analytics/sor-all-styles", headers=headers, timeout=30)
    elapsed = time.time() - t0
    assert r.status_code == 200
    assert elapsed < 5, f"warm cache call took {elapsed:.1f}s, expected <5s"


def test_sor_all_styles_count(headers):
    """Should have ~1700 styles per problem statement."""
    r = requests.get(f"{BASE_URL}/api/analytics/sor-all-styles", headers=headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    print(f"Total styles: {len(data)}")
    assert len(data) > 500, f"expected many styles (>500), got {len(data)}"
