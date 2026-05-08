"""Vivo Clienteling backend test suite.

Covers: auth gating, BI proxy, notes, tasks, preferences, templates (manager-only),
messages w/ consent gating, lookbooks (auth + public), audit, dashboards, role enforcement.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crm-platform-145.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MGR_TOKEN = os.environ.get("MGR_TOKEN", "test_session_vivo_mgr_1778250692444")
ASSOC_TOKEN = os.environ.get("ASSOC_TOKEN", "test_session_vivo_assoc_1778250692444")


@pytest.fixture(scope="session")
def mgr():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {MGR_TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def assoc():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ASSOC_TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def real_customer_id(mgr):
    r = mgr.get(f"{API}/bi/customer-search", params={"q": "jane"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list) and len(data) > 0, "No customers from BI search"
    cid = data[0].get("customer_id")
    assert cid, f"missing customer_id in {data[0]}"
    return cid


# --- Health & Auth gating --- #
class TestHealthAuth:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok"
        assert d["bi_api_reachable"] is True

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_mgr(self, mgr):
        r = mgr.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "manager"
        assert d["email"] == "test.vivo.mgr@example.com"

    def test_me_assoc(self, assoc):
        r = assoc.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "associate"


# --- BI proxy --- #
class TestBI:
    DF, DT = "2026-04-01", "2026-04-30"

    def test_kpis(self, mgr):
        r = mgr.get(f"{API}/bi/kpis", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200
        assert isinstance(r.json(), (dict, list))

    def test_country_summary(self, mgr):
        r = mgr.get(f"{API}/bi/country-summary", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200

    def test_top_customers(self, mgr):
        r = mgr.get(f"{API}/bi/top-customers", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200

    def test_customer_search(self, mgr):
        r = mgr.get(f"{API}/bi/customer-search", params={"q": "jane"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_customer_profile(self, mgr, real_customer_id):
        r = mgr.get(f"{API}/bi/customer/{real_customer_id}")
        assert r.status_code == 200
        d = r.json()
        assert "profile" in d and "products" in d

    def test_churned(self, mgr):
        r = mgr.get(f"{API}/bi/churned-customers")
        assert r.status_code == 200

    def test_locations(self, mgr):
        r = mgr.get(f"{API}/bi/locations")
        assert r.status_code == 200

    def test_top_skus(self, mgr):
        r = mgr.get(f"{API}/bi/top-skus", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200

    def test_daily_trend(self, mgr):
        r = mgr.get(f"{API}/bi/daily-trend", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200

    def test_sales_summary(self, mgr):
        r = mgr.get(f"{API}/bi/sales-summary", params={"date_from": self.DF, "date_to": self.DT})
        assert r.status_code == 200

    def test_bi_unauth(self):
        r = requests.get(f"{API}/bi/locations")
        assert r.status_code == 401


# --- Notes --- #
class TestNotes:
    def test_notes_crud(self, mgr, real_customer_id):
        r = mgr.post(f"{API}/notes", json={"customer_id": real_customer_id, "body": "TEST_note body"})
        assert r.status_code == 200, r.text
        nid = r.json()["note_id"]
        r2 = mgr.get(f"{API}/notes", params={"customer_id": real_customer_id})
        assert r2.status_code == 200
        assert any(n["note_id"] == nid for n in r2.json())
        r3 = mgr.delete(f"{API}/notes/{nid}")
        assert r3.status_code == 200
        assert r3.json()["deleted"] == 1


# --- Tasks --- #
class TestTasks:
    def test_tasks_flow(self, mgr, real_customer_id):
        r = mgr.post(f"{API}/tasks", json={"customer_id": real_customer_id, "title": "TEST_task", "due_date": "2026-06-01"})
        assert r.status_code == 200
        tid = r.json()["task_id"]
        r2 = mgr.get(f"{API}/tasks", params={"customer_id": real_customer_id})
        assert any(t["task_id"] == tid for t in r2.json())
        r3 = mgr.post(f"{API}/tasks/{tid}/complete")
        assert r3.status_code == 200
        assert r3.json()["completed"] is True
        r4 = mgr.get(f"{API}/tasks", params={"mine": "true"})
        assert r4.status_code == 200
        mgr.delete(f"{API}/tasks/{tid}")


# --- Preferences --- #
class TestPreferences:
    def test_prefs_upsert(self, mgr, real_customer_id):
        payload = {"sizes": {"top": "M", "bottom": "32"}, "fits": ["slim"], "fabrics": ["wool"], "occasions": ["evening"], "brands": ["Vivo"]}
        r = mgr.put(f"{API}/preferences/{real_customer_id}", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["sizes"]["top"] == "M"
        r2 = mgr.get(f"{API}/preferences/{real_customer_id}")
        assert r2.status_code == 200
        assert r2.json()["fits"] == ["slim"]


# --- Templates --- #
class TestTemplates:
    def test_seeded(self, mgr):
        r = mgr.get(f"{API}/templates")
        assert r.status_code == 200
        assert len(r.json()) >= 4

    def test_create_manager(self, mgr):
        r = mgr.post(f"{API}/templates", json={"name": f"TEST_tmpl_{uuid.uuid4().hex[:6]}", "channel": "sms", "body": "hi"})
        assert r.status_code == 200
        tid = r.json()["template_id"]
        r2 = mgr.delete(f"{API}/templates/{tid}")
        assert r2.status_code == 200


# --- Messages + Consent --- #
class TestMessagesConsent:
    def test_send_then_optout_blocks(self, mgr, real_customer_id):
        # Use a fresh sub-customer id to keep consent state isolated
        cid = f"TEST_cust_{uuid.uuid4().hex[:8]}"
        # Send is allowed (no consent)
        r = mgr.post(f"{API}/messages", json={"customer_id": cid, "channel": "whatsapp", "body": "hello"})
        assert r.status_code == 200
        assert r.json()["delivery_status"] == "mock_delivered"
        # Opt-out
        r2 = mgr.post(f"{API}/consent", json={"customer_id": cid, "channel": "whatsapp", "opted_in": False})
        assert r2.status_code == 200
        # Now send should fail with 400
        r3 = mgr.post(f"{API}/messages", json={"customer_id": cid, "channel": "whatsapp", "body": "again"})
        assert r3.status_code == 400, r3.text
        # consent listing
        r4 = mgr.get(f"{API}/consent/{cid}")
        assert r4.status_code == 200
        assert len(r4.json()) >= 1


# --- Lookbooks (auth + public) --- #
class TestLookbooks:
    def test_create_and_share(self, mgr, real_customer_id):
        items = [
            {"sku": "SKU1", "product_title": "Coat", "image": "x.jpg", "price": 100},
            {"sku": "SKU2", "product_title": "Shirt", "image": "y.jpg", "price": 50},
            {"sku": "SKU3", "product_title": "Pants", "image": "z.jpg", "price": 80},
        ]
        r = mgr.post(f"{API}/lookbooks", json={"customer_id": real_customer_id, "title": "TEST_LB", "items": items})
        assert r.status_code == 200, r.text
        d = r.json()
        token = d["share_token"]
        # Public access (no auth)
        r2 = requests.get(f"{API}/public/lookbooks/{token}")
        assert r2.status_code == 200
        assert r2.json()["lookbook_id"] == d["lookbook_id"]
        # Interest
        r3 = requests.post(f"{API}/public/lookbooks/{token}/interest", json={"sku": "SKU1", "product_title": "Coat"})
        assert r3.status_code == 200
        assert r3.json()["ok"] is True


# --- Audit --- #
class TestAudit:
    def test_audit_manager_only(self, mgr):
        r = mgr.get(f"{API}/audit")
        assert r.status_code == 200
        actions = {ev.get("action") for ev in r.json()}
        # At least some of the actions we just performed
        assert actions & {"customer.view", "note.create", "message.send", "lookbook.create"}

    def test_audit_assoc_forbidden(self, assoc):
        r = assoc.get(f"{API}/audit")
        assert r.status_code == 403


# --- Dashboards & Role enforcement --- #
class TestDashboards:
    def test_me_dash(self, mgr):
        r = mgr.get(f"{API}/dashboard/me")
        assert r.status_code == 200
        d = r.json()
        for k in ("messages_this_week", "open_tasks", "tasks", "recent_notes"):
            assert k in d

    def test_manager_dash(self, mgr):
        r = mgr.get(f"{API}/dashboard/manager")
        assert r.status_code == 200
        d = r.json()
        assert "totals" in d and "by_associate" in d

    def test_manager_dash_assoc_forbidden(self, assoc):
        r = assoc.get(f"{API}/dashboard/manager")
        assert r.status_code == 403

    def test_template_create_assoc_forbidden(self, assoc):
        r = assoc.post(f"{API}/templates", json={"name": "x", "channel": "sms", "body": "x"})
        assert r.status_code == 403
