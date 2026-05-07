"""Iteration 53 — IBT mark-as-done flow + pending user approval flow."""
import os
import uuid
from datetime import datetime, timezone, timedelta
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"
VIEWER_EMAIL = "viewer@vivofashiongroup.com"
VIEWER_PASS = "Viewer!2026"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def viewer_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": VIEWER_EMAIL, "password": VIEWER_PASS}, timeout=30)
    if r.status_code != 200:
        pytest.skip("viewer login failed")
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- IBT completed/keys ----------
class TestIBTCompletedKeys:
    def test_keys_endpoint_any_user(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/ibt/completed/keys", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "keys" in data
        assert isinstance(data["keys"], list)

    def test_keys_endpoint_viewer(self, viewer_token):
        r = requests.get(f"{BASE_URL}/api/ibt/completed/keys", headers=_h(viewer_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json().get("keys"), list)


# ---------- POST /api/ibt/complete ----------
class TestIBTComplete:
    def _payload(self, **over):
        today = datetime.now(timezone.utc).date().isoformat()
        base = {
            "style_name": f"TEST_Style_{uuid.uuid4().hex[:6]}",
            "from_store": "TEST_FROM",
            "to_store": "TEST_TO",
            "units_to_move": 5,
            "actual_units_moved": 3,
            "po_number": "PO-TEST-1",
            "completed_by_name": "Test Picker",
            "transfer_date": today,
            "suggested_date": today,
            "flow": "store_to_store",
        }
        base.update(over)
        return base

    def test_complete_valid(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/ibt/complete", headers=_h(admin_token), json=self._payload(), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data
        assert data["days_lapsed"] == 0
        assert data["actual_units_moved"] == 3

    def test_days_lapsed_computed(self, admin_token):
        sug = (datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat()
        today = datetime.now(timezone.utc).date().isoformat()
        r = requests.post(f"{BASE_URL}/api/ibt/complete", headers=_h(admin_token),
                          json=self._payload(suggested_date=sug, transfer_date=today), timeout=30)
        assert r.status_code == 200
        assert r.json()["days_lapsed"] == 2

    def test_reject_transfer_before_suggested(self, admin_token):
        sug = datetime.now(timezone.utc).date().isoformat()
        past = (datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat()
        r = requests.post(f"{BASE_URL}/api/ibt/complete", headers=_h(admin_token),
                          json=self._payload(suggested_date=sug, transfer_date=past), timeout=30)
        assert r.status_code == 400

    def test_reject_actual_exceeds_suggested(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/ibt/complete", headers=_h(admin_token),
                          json=self._payload(units_to_move=2, actual_units_moved=5), timeout=30)
        assert r.status_code == 400


# ---------- GET /api/ibt/completed (admin only) ----------
class TestListCompleted:
    def test_admin_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/ibt/completed", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)

    def test_viewer_forbidden(self, viewer_token):
        r = requests.get(f"{BASE_URL}/api/ibt/completed", headers=_h(viewer_token), timeout=30)
        assert r.status_code == 403


# ---------- Pending user approval ----------
@pytest.fixture(scope="module")
def pending_user(admin_token):
    """Insert a pending user via Mongo, yield user_id, cleanup at end."""
    import asyncio
    # Load from backend/.env to point at the same DB the running backend uses.
    from pathlib import Path
    env_path = Path("/app/backend/.env")
    env = {}
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    mongo_url = env.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = env.get("DB_NAME", "test_database")
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    email = f"TEST_pending_{uuid.uuid4().hex[:6]}@vivofashiongroup.com"
    session_token = uuid.uuid4().hex + uuid.uuid4().hex

    async def setup():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": "TEST Pending", "picture": None,
            "role": "store_manager", "active": True, "status": "pending",
            "auth_method": "google", "created_at": datetime.now(timezone.utc),
        })
        await db.user_sessions.insert_one({
            "user_id": user_id, "session_token": session_token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        client.close()

    async def cleanup():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.users.delete_one({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        client.close()

    asyncio.run(setup())
    yield {"user_id": user_id, "email": email, "token": session_token}
    asyncio.run(cleanup())


class TestPendingFlow:
    def test_admin_lists_pending_user(self, admin_token, pending_user):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        emails = [u.get("email") for u in r.json()]
        assert pending_user["email"] in emails

    def test_pending_me_returns_403_with_detail(self, pending_user):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(pending_user["token"]), timeout=30)
        assert r.status_code == 403
        assert r.json().get("detail") == "account_pending_approval"

    def test_pending_me_status_returns_200(self, pending_user):
        r = requests.get(f"{BASE_URL}/api/auth/me/status", headers=_h(pending_user["token"]), timeout=30)
        assert r.status_code == 200
        assert r.json().get("status") == "pending"
        assert r.json().get("email") == pending_user["email"]

    def test_patch_invalid_status_returns_400(self, admin_token, pending_user):
        r = requests.patch(f"{BASE_URL}/api/admin/users/{pending_user['user_id']}",
                           headers=_h(admin_token), json={"status": "garbage"}, timeout=30)
        assert r.status_code == 400

    def test_patch_status_active_works(self, admin_token, pending_user):
        r = requests.patch(f"{BASE_URL}/api/admin/users/{pending_user['user_id']}",
                           headers=_h(admin_token), json={"status": "active"}, timeout=30)
        assert r.status_code == 200
        # verify
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(pending_user["token"]), timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("status") == "active"

    def test_patch_status_rejected_works(self, admin_token, pending_user):
        r = requests.patch(f"{BASE_URL}/api/admin/users/{pending_user['user_id']}",
                           headers=_h(admin_token), json={"status": "rejected"}, timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(pending_user["token"]), timeout=30)
        assert r2.status_code == 403
        assert r2.json().get("detail") == "account_rejected"


class TestAdminBackfill:
    def test_admin_status_active_after_migration(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json().get("status") == "active"
