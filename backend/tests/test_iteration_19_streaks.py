"""
Iteration 19 — Dopamine Design Phase 4.
Tests /api/auth/activity-streak and /api/leaderboard/streaks (records).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ------------- /api/auth/activity-streak -------------
class TestActivityStreak:
    def test_unauth_returns_401(self, api_client):
        r = requests.get(f"{BASE_URL}/api/auth/activity-streak", timeout=15)
        assert r.status_code == 401

    def test_auth_shape(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/auth/activity-streak",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Required keys
        assert "streak" in data
        assert "visits_30d" in data
        assert "today_active" in data
        # Types
        assert isinstance(data["streak"], int)
        assert isinstance(data["visits_30d"], int)
        assert isinstance(data["today_active"], bool)
        # Non-negative
        assert data["streak"] >= 0
        assert data["visits_30d"] >= 0
        # Since we just hit an authenticated endpoint, today_active should be true
        # (middleware logs the call). streak should be >= 1.
        assert data["today_active"] is True
        assert data["streak"] >= 1


# ------------- /api/leaderboard/streaks -------------
class TestLeaderboardStreaks:
    def test_auth_shape(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/leaderboard/streaks?lookback_months=6",
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("top_seller", "highest_abv", "top_conversion", "records"):
            assert k in data, f"missing key {k}"
        # streaks are mappings {winner: streak_count}
        for k in ("top_seller", "highest_abv", "top_conversion"):
            assert isinstance(data[k], dict)
        # records has the three badge keys
        recs = data["records"]
        assert isinstance(recs, dict)
        for k in ("top_seller", "highest_abv", "top_conversion"):
            assert k in recs, f"records missing {k}"
            val = recs[k]
            # Either None or {winner, value}
            assert val is None or (
                isinstance(val, dict) and "winner" in val and "value" in val
            )

    def test_no_mongo_id_leak(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/leaderboard/streaks?lookback_months=6",
            headers=auth_headers,
            timeout=60,
        )
        assert "_id" not in r.text


# ------------- Basic regression (no field regressed) -------------
class TestRegression:
    def test_me(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_kpis_load(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/kpis?date_from=2026-04-01&date_to=2026-04-19",
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200
        assert "_id" not in r.text
