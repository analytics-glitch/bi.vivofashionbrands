"""Iter11 — domain allowlist for Emergent Google sign-in.

Verifies:
1. Unit: _email_domain_allowed() across allow/block cases.
2. ALLOWED_EMAIL_DOMAINS env var override is honoured.
3. POST /api/auth/session with invalid session_id still returns 401 (regression).
4. Seeded test sessions for manager + associate continue to authenticate
   /api/auth/me with role preserved.
"""
from __future__ import annotations

import importlib
import os
import sys

import pytest
import requests

def _load_base_url() -> str:
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        # fallback: read from frontend/.env (testing-only)
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    url = line.split("=", 1)[1].strip().strip('"')
                    break
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return url.rstrip("/")


BASE_URL = _load_base_url()
sys.path.insert(0, "/app/backend")


# ------------------------ unit: _email_domain_allowed ------------------------

class TestEmailDomainAllowed:
    """Pure-function tests on the helper."""

    def setup_method(self):
        os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
        if "server" in sys.modules:
            del sys.modules["server"]
        self.server = importlib.import_module("server")

    def test_allows_vivofashiongroup(self):
        assert self.server._email_domain_allowed("x@vivofashiongroup.com") is True

    def test_allows_shopzetu_case_insensitive(self):
        assert self.server._email_domain_allowed("SHOP@SHOPZETU.COM") is True

    def test_blocks_gmail(self):
        assert self.server._email_domain_allowed("attacker@gmail.com") is False

    def test_blocks_subdomain_lookalike(self):
        assert self.server._email_domain_allowed("a@evil-shopzetu.com.x") is False

    def test_blocks_outlook(self):
        assert self.server._email_domain_allowed("user@outlook.com") is False

    def test_default_set_is_vivo_and_shopzetu(self):
        assert self.server.ALLOWED_EMAIL_DOMAINS == {"vivofashiongroup.com", "shopzetu.com"}


class TestEmailDomainAllowedEnvOverride:
    """Verifies ALLOWED_EMAIL_DOMAINS env override is honoured."""

    def teardown_method(self):
        os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
        if "server" in sys.modules:
            del sys.modules["server"]

    def test_env_override_custom_domain(self):
        os.environ["ALLOWED_EMAIL_DOMAINS"] = "example.com,foo.io"
        if "server" in sys.modules:
            del sys.modules["server"]
        server = importlib.import_module("server")
        assert server.ALLOWED_EMAIL_DOMAINS == {"example.com", "foo.io"}
        assert server._email_domain_allowed("u@example.com") is True
        assert server._email_domain_allowed("u@foo.io") is True
        assert server._email_domain_allowed("u@vivofashiongroup.com") is False

    def test_env_empty_disables_allowlist(self):
        os.environ["ALLOWED_EMAIL_DOMAINS"] = ""
        if "server" in sys.modules:
            del sys.modules["server"]
        server = importlib.import_module("server")
        assert server.ALLOWED_EMAIL_DOMAINS == set()
        # When disabled, anything passes
        assert server._email_domain_allowed("anyone@anywhere.xyz") is True


# ------------------------ API: regression on /auth/session -------------------

class TestAuthSessionRegression:
    """Existing 401 behaviour must continue working."""

    def test_invalid_session_id_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "nope-this-cannot-exist-xyz-1234"},
            timeout=15,
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert body.get("detail") == "Invalid session_id"

    def test_missing_session_id_returns_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={}, timeout=10)
        assert r.status_code == 400, r.text
        assert "session_id" in r.json().get("detail", "")


# ------------------------ API: seeded test sessions still work ---------------

MGR_TOKEN = "test_session_vivo_mgr_1778250692444"
ASSOC_TOKEN = "test_session_vivo_assoc_1778250692444"


class TestSeededSessionsBypass:
    """The seeded test sessions bypass the Emergent exchange entirely."""

    def test_manager_me_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {MGR_TOKEN}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "manager"
        assert data["email"].endswith("@example.com")
        assert "user_id" in data

    def test_associate_me_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {ASSOC_TOKEN}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "associate"
        assert "user_id" in data

    def test_no_token_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
