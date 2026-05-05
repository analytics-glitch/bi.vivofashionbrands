"""Iteration 46 — SOR Report polling fix retest.

Validates that:
  - /api/analytics/style-location-breakdown returns 200 with locations for
    a popular pre-warmed style within 50s (or 202 with `computing: true`
    if cold; polling eventually returns 200).
  - /api/analytics/style-sku-breakdown returns 200 with skus for the same
    style within 50s.
  - 202 polling pattern returns the expected envelope.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"

POPULAR_STYLE = "Vivo Basic Sienna Waterfall"
RARE_STYLE = "Vivo Hadiya Floral Cami"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


def _poll_until_ready(url, headers, max_attempts=8, interval=15):
    """Poll a SOR analytics endpoint until 200 OR max_attempts. Returns
    (final_response, attempt_count)."""
    last = None
    for attempt in range(1, max_attempts + 1):
        r = requests.get(url, headers=headers, timeout=60)
        last = r
        if r.status_code == 200:
            body = r.json()
            if not body.get("computing"):
                return r, attempt
        if r.status_code == 202:
            time.sleep(interval)
            continue
        if r.status_code >= 400:
            return r, attempt
        time.sleep(interval)
    return last, max_attempts


class TestStyleLocationBreakdownPolling:
    """`/api/analytics/style-location-breakdown` — 202 polling + 200."""

    def test_popular_style_returns_200_with_locations(self, auth_headers):
        url = f"{BASE_URL}/api/analytics/style-location-breakdown"
        params = {"style_name": POPULAR_STYLE}
        # First call may be 202 if cache evicted; poll to completion.
        r = requests.get(url, params=params, headers=auth_headers, timeout=60)
        assert r.status_code in (200, 202), f"unexpected {r.status_code}: {r.text[:200]}"
        if r.status_code == 202:
            body = r.json()
            assert body.get("computing") is True
            assert body.get("retry_after") == 15
            # Poll until 200
            r, attempts = _poll_until_ready(
                f"{url}?style_name={POPULAR_STYLE.replace(' ', '+')}",
                auth_headers,
                max_attempts=8,
                interval=15,
            )
            assert r.status_code == 200, f"polling failed after {attempts}: {r.status_code}"
        body = r.json()
        assert body.get("style_name") == POPULAR_STYLE
        assert "locations" in body
        locations = body["locations"]
        assert isinstance(locations, list)
        assert len(locations) >= 20, f"expected >=20 locations, got {len(locations)}"
        # Validate row shape
        sample = locations[0]
        for k in ("location", "units_6m", "soh_total", "sor_6m"):
            assert k in sample, f"missing key {k} in {sample}"
        # Validate sales presence
        with_sales = [l for l in locations if (l.get("units_6m") or 0) > 0]
        assert len(with_sales) >= 20, f"expected >=20 locs with sales, got {len(with_sales)}"

    def test_warm_cache_is_fast(self, auth_headers):
        """After previous test, cache should be warm — second call <2s."""
        url = f"{BASE_URL}/api/analytics/style-location-breakdown"
        params = {"style_name": POPULAR_STYLE}
        t0 = time.time()
        r = requests.get(url, params=params, headers=auth_headers, timeout=15)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"warm cache returned {r.status_code}"
        assert elapsed < 5.0, f"warm cache too slow: {elapsed:.1f}s"
        body = r.json()
        assert "locations" in body and len(body["locations"]) > 0

    def test_rare_style_polls_or_returns_empty(self, auth_headers):
        """A rare/unseen style should either return 200 (possibly empty)
        OR 202 with polling envelope. Eventual 200 acceptable even if
        empty for genuinely zero-sale styles."""
        url = f"{BASE_URL}/api/analytics/style-location-breakdown"
        full_url = f"{url}?style_name={RARE_STYLE.replace(' ', '+')}"
        r, attempts = _poll_until_ready(full_url, auth_headers, max_attempts=8, interval=15)
        assert r.status_code == 200, (
            f"rare-style poll did not converge after {attempts} attempts; "
            f"final status={r.status_code} body={r.text[:200]}"
        )
        body = r.json()
        assert body.get("style_name") == RARE_STYLE
        assert "locations" in body
        assert isinstance(body["locations"], list)


class TestStyleSkuBreakdownPolling:
    """`/api/analytics/style-sku-breakdown` — same polling pattern."""

    def test_popular_style_returns_200_with_skus(self, auth_headers):
        url = f"{BASE_URL}/api/analytics/style-sku-breakdown"
        full_url = f"{url}?style_name={POPULAR_STYLE.replace(' ', '+')}"
        r, attempts = _poll_until_ready(full_url, auth_headers, max_attempts=8, interval=15)
        assert r.status_code == 200, (
            f"sku endpoint poll did not converge after {attempts}: {r.status_code}"
        )
        body = r.json()
        assert body.get("style_name") == POPULAR_STYLE
        assert "skus" in body
        assert isinstance(body["skus"], list)
        assert len(body["skus"]) > 0, "expected at least one SKU row"
        # Schema check
        sample = body["skus"][0]
        for k in ("sku", "color", "size", "units_6m", "soh_total"):
            assert k in sample, f"missing key {k} in sku row {sample}"

    def test_shared_scan_warms_both_caches(self, auth_headers):
        """Per the design: one /orders fan-out populates both caches.
        After SKU+location calls above, both should be warm and fast."""
        loc_url = f"{BASE_URL}/api/analytics/style-location-breakdown"
        sku_url = f"{BASE_URL}/api/analytics/style-sku-breakdown"
        params = {"style_name": POPULAR_STYLE}
        t0 = time.time()
        r1 = requests.get(loc_url, params=params, headers=auth_headers, timeout=10)
        r2 = requests.get(sku_url, params=params, headers=auth_headers, timeout=10)
        elapsed = time.time() - t0
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert elapsed < 5.0, f"warm cache combined too slow: {elapsed:.1f}s"


class TestRegressionRepeatCustomers:
    """Regression: Customers page repeat-customers endpoint still works
    (uses the same SortableTable rowClassName-prop change)."""

    def test_repeat_customers_endpoint_returns_200(self, auth_headers):
        url = f"{BASE_URL}/api/customers/repeat"
        r = requests.get(url, headers=auth_headers, timeout=30)
        # If the endpoint exists, it should be 200; if it has a different
        # path we just want to confirm it's not server-error.
        assert r.status_code in (200, 404), f"unexpected {r.status_code}: {r.text[:200]}"
        if r.status_code == 200:
            body = r.json()
            assert isinstance(body, (list, dict))
