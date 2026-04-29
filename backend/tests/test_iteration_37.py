"""Iteration 37 — role-based page access via /auth/me + /auth/login allowed_pages.

Validates:
  - admin login + /auth/me returns allowed_pages with all 14 page IDs
  - viewer login + /auth/me returns the 4-page viewer set
  - login response body shape mirrors /me (token + user{...,allowed_pages})
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"
VIEWER_EMAIL = "viewer@vivofashiongroup.com"
VIEWER_PASS = "Viewer!2026"

ADMIN_PAGES = [
    "overview", "locations", "footfall", "customers",
    "inventory", "re-order", "ibt",
    "products", "pricing", "data-quality",
    "ceo-report", "exports",
    "admin-users", "admin-activity-logs",
]
VIEWER_PAGES = ["overview", "locations", "footfall", "customers"]


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password},
                      timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


# ---- /auth/login response shape ----
class TestLoginAllowedPages:
    def test_admin_login_includes_allowed_pages(self):
        body = _login(ADMIN_EMAIL, ADMIN_PASS)
        assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 0
        assert "user" in body
        u = body["user"]
        assert u["email"] == ADMIN_EMAIL
        assert u["role"] == "admin"
        assert "allowed_pages" in u, "login.user missing allowed_pages"
        assert isinstance(u["allowed_pages"], list)
        assert sorted(u["allowed_pages"]) == sorted(ADMIN_PAGES), \
            f"admin allowed_pages mismatch: {u['allowed_pages']}"
        assert len(u["allowed_pages"]) == 14

    def test_viewer_login_includes_allowed_pages(self):
        body = _login(VIEWER_EMAIL, VIEWER_PASS)
        u = body["user"]
        assert u["email"] == VIEWER_EMAIL
        assert u["role"] == "viewer"
        assert "allowed_pages" in u
        assert sorted(u["allowed_pages"]) == sorted(VIEWER_PAGES)
        assert len(u["allowed_pages"]) == 4


# ---- /auth/me response shape ----
class TestMeAllowedPages:
    def test_admin_me_returns_all_14_pages(self):
        token = _login(ADMIN_EMAIL, ADMIN_PASS)["token"]
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "admin"
        assert "allowed_pages" in data
        ap = data["allowed_pages"]
        assert isinstance(ap, list)
        assert len(ap) == 14
        for p in ADMIN_PAGES:
            assert p in ap, f"admin /me missing {p}"

    def test_viewer_me_returns_4_pages_only(self):
        token = _login(VIEWER_EMAIL, VIEWER_PASS)["token"]
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "viewer"
        ap = data["allowed_pages"]
        assert sorted(ap) == sorted(VIEWER_PAGES)
        # explicitly NOT in viewer's set
        for forbidden in ["inventory", "products", "re-order", "ibt", "pricing",
                          "ceo-report", "data-quality", "exports",
                          "admin-users", "admin-activity-logs"]:
            assert forbidden not in ap, f"viewer should NOT have {forbidden}"


# ---- shape parity between /login and /me ----
class TestLoginMeParity:
    def test_login_user_shape_matches_me(self):
        login_body = _login(ADMIN_EMAIL, ADMIN_PASS)
        token = login_body["token"]
        login_user = login_body["user"]
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=30)
        me_user = r.json()
        # both must carry allowed_pages with the same content
        assert sorted(login_user["allowed_pages"]) == sorted(me_user["allowed_pages"])
        # core identity fields match
        for f in ("user_id", "email", "role"):
            assert login_user[f] == me_user[f]
