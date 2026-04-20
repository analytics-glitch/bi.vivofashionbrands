"""Iteration 8 — Auth & admin backend tests for Vivo BI Dashboard."""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Auth ----------
class TestAuth:
    def test_kpis_without_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/kpis", timeout=30)
        assert r.status_code == 401

    def test_health_is_public(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=30)
        assert r.status_code == 200

    def test_login_success_returns_admin(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("token"), str) and len(data["token"]) > 20
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "admin"

    def test_login_wrong_password_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": "WRONGPASS!!"},
            timeout=30,
        )
        assert r.status_code == 401
        assert "Invalid credentials" in r.text

    def test_google_callback_bogus_session_returns_400(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/google/callback",
            json={"session_id": "bogus-session-id-123"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_me_without_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401

    def test_me_with_bearer_returns_user(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"

    def test_kpis_with_auth_returns_data(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": "2026-04-01", "date_to": "2026-04-19"},
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_sales" in data or "gross_sales" in data


# ---------- Activity logs ----------
class TestActivityLogs:
    def test_activity_log_records_authed_kpi_call(self, admin_headers):
        # Make a unique call so we can find it in logs
        r1 = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": "2026-04-10", "date_to": "2026-04-11"},
            headers=admin_headers,
            timeout=60,
        )
        assert r1.status_code == 200
        time.sleep(1.5)  # allow middleware insert to flush
        r2 = requests.get(
            f"{BASE_URL}/api/admin/activity-logs",
            params={"path": "/api/kpis", "limit": 50},
            headers=admin_headers,
            timeout=30,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert "rows" in data and isinstance(data["rows"], list)
        assert data["total"] >= 1
        # at least one row with our admin email & /api/kpis path
        matches = [row for row in data["rows"] if row.get("path") == "/api/kpis" and row.get("email") == ADMIN_EMAIL]
        assert len(matches) >= 1


# ---------- Admin user management ----------
class TestAdminUsers:
    created_user_id = None
    viewer_email = f"test_viewer_{uuid.uuid4().hex[:8]}@vivofashiongroup.com"
    viewer_password = "ViewerPass!2026"

    def test_list_users_as_admin(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        emails = {u["email"] for u in users}
        assert ADMIN_EMAIL in emails

    def test_create_viewer_user(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={
                "email": self.__class__.viewer_email,
                "name": "TEST Viewer",
                "password": self.__class__.viewer_password,
                "role": "viewer",
            },
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["role"] == "viewer"
        assert doc["email"] == self.__class__.viewer_email
        assert "user_id" in doc
        TestAdminUsers.created_user_id = doc["user_id"]

    def test_new_viewer_can_login(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.__class__.viewer_email, "password": self.__class__.viewer_password},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "viewer"

    def test_viewer_cannot_list_users(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.__class__.viewer_email, "password": self.__class__.viewer_password},
            timeout=30,
        )
        viewer_token = r.json()["token"]
        r2 = requests.get(
            f"{BASE_URL}/api/admin/users",
            headers={"Authorization": f"Bearer {viewer_token}"},
            timeout=30,
        )
        assert r2.status_code == 403

    def test_update_user_role(self, admin_headers):
        uid = TestAdminUsers.created_user_id
        assert uid, "previous create test must run first"
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            json={"role": "admin"},
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        # verify via list
        r2 = requests.get(f"{BASE_URL}/api/admin/users", headers=admin_headers, timeout=30)
        u = next((x for x in r2.json() if x["user_id"] == uid), None)
        assert u is not None and u["role"] == "admin"

    def test_cannot_demote_self(self, admin_headers, admin_token):
        # Identify admin's own user_id
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=30).json()
        my_id = me["user_id"]
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{my_id}",
            json={"role": "viewer"},
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 400
        assert "demote" in r.text.lower()

    def test_cleanup_delete_user(self, admin_headers):
        uid = TestAdminUsers.created_user_id
        if not uid:
            pytest.skip("no user created")
        r = requests.delete(f"{BASE_URL}/api/admin/users/{uid}", headers=admin_headers, timeout=30)
        assert r.status_code == 200


# ---------- Logout ----------
class TestLogout:
    def test_logout_invalidates_token(self):
        # login fresh so we don't kill module admin_token
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30,
        )
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        # token works first
        r1 = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=30)
        assert r1.status_code == 200
        # logout
        r2 = requests.post(f"{BASE_URL}/api/auth/logout", headers=h, timeout=30)
        assert r2.status_code == 200
        # token no longer works
        r3 = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=30)
        assert r3.status_code == 401
