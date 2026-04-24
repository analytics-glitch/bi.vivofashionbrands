"""Iteration 20 — Store of the Week + Confetti + regression backend tests."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PW = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Store of the Week endpoint ----------
class TestStoreOfTheWeek:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week", timeout=60)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_payload_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        # Top-level keys
        for k in ("window", "prev_window", "top_seller", "highest_abv", "top_conversion"):
            assert k in data, f"missing top-level key: {k}"
        # window shape (may be None only on total compute failure)
        if data["window"]:
            assert "start" in data["window"] and "end" in data["window"]
        if data["prev_window"]:
            assert "start" in data["prev_window"] and "end" in data["prev_window"]
        # Each winner (when present) must have required keys
        for badge in ("top_seller", "highest_abv", "top_conversion"):
            w = data[badge]
            if w is None:
                continue
            for k in ("winner", "value", "sales", "orders", "pct_vs_prev_week", "metric"):
                assert k in w, f"{badge} missing key {k}: {w}"
            assert isinstance(w["winner"], str) and len(w["winner"]) > 0
            assert isinstance(w["sales"], (int, float))
            assert isinstance(w["orders"], (int, float))

    def test_no_id_leakage(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert '"_id"' not in r.text

    def test_cache_behavior(self, auth_headers):
        """Two rapid calls should return identical data (15-min in-memory cache)."""
        t1 = time.time()
        r1 = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week",
                          headers=auth_headers, timeout=30)
        d1 = time.time() - t1
        assert r1.status_code == 200
        t2 = time.time()
        r2 = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week",
                          headers=auth_headers, timeout=30)
        d2 = time.time() - t2
        assert r2.status_code == 200
        assert r1.json() == r2.json(), "cache should yield identical payload"
        # second call should be fast (<1s) due to in-memory cache
        assert d2 < 2.0, f"second call took {d2:.2f}s — cache may be broken"

    def test_window_is_7_day_range(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leaderboard/store-of-the-week",
                         headers=auth_headers, timeout=30)
        data = r.json()
        w = data.get("window")
        if not w:
            pytest.skip("no window data")
        from datetime import date
        s = date.fromisoformat(w["start"])
        e = date.fromisoformat(w["end"])
        assert (e - s).days == 6, f"expected inclusive 7-day window, got {(e-s).days+1}"


# ---------- Regression ----------
class TestRegression:
    def test_kpis_ok(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/kpis?date_from=2026-04-01&date_to=2026-04-19",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert '"_id"' not in r.text

    def test_streaks_ok(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leaderboard/streaks?lookback_months=6",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("top_seller", "highest_abv", "top_conversion", "records"):
            assert k in data

    def test_activity_streak_ok(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/activity-streak",
                         headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "streak" in data
