"""Tests for GET /api/analytics/style-location-breakdown (iter 45)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_location_breakdown_known_style(headers):
    """Pre-confirmed: 'Vivo Basic Sienna Waterfall' has 29 locations."""
    r = requests.get(
        f"{BASE_URL}/api/analytics/style-location-breakdown",
        params={"style_name": "Vivo Basic Sienna Waterfall"},
        headers=headers,
        timeout=180,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
    data = r.json()
    assert "style_name" in data
    assert data["style_name"] == "Vivo Basic Sienna Waterfall"
    assert "locations" in data
    locs = data["locations"]
    assert isinstance(locs, list)
    assert len(locs) >= 20, f"expected >=20 locations, got {len(locs)}"
    # Each entry has required fields
    required = {"location", "units_6m", "soh_total", "sor_6m"}
    for entry in locs:
        assert required.issubset(entry.keys()), f"missing fields in {entry}"
        assert isinstance(entry["location"], str) and entry["location"]
        assert isinstance(entry["units_6m"], (int, float))
        assert isinstance(entry["soh_total"], (int, float))
        assert isinstance(entry["sor_6m"], (int, float))


def test_location_breakdown_nonexistent_style(headers):
    r = requests.get(
        f"{BASE_URL}/api/analytics/style-location-breakdown",
        params={"style_name": "NonexistentStyle_ZZZ_XYZ_2026"},
        headers=headers,
        timeout=180,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
    data = r.json()
    assert data.get("locations") == [], f"expected empty locations, got {data.get('locations')}"


def test_location_breakdown_cached(headers):
    """Second call on same style should be much faster (cache hit)."""
    import time
    t0 = time.time()
    r = requests.get(
        f"{BASE_URL}/api/analytics/style-location-breakdown",
        params={"style_name": "Vivo Basic Sienna Waterfall"},
        headers=headers,
        timeout=60,
    )
    elapsed = time.time() - t0
    assert r.status_code == 200
    assert elapsed < 30, f"cache hit should be fast, took {elapsed:.1f}s"
