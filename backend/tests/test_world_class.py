"""Iteration 4 — World-class enhancements (RFM, call list, attribution, NBA, forget, anniversaries)."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://crm-platform-145.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MGR = "test_session_vivo_mgr_1778250692444"
ASSOC = "test_session_vivo_assoc_1778250692444"
JANET = "3846911099035"


@pytest.fixture(scope="session")
def mgr():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {MGR}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def assoc():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ASSOC}", "Content-Type": "application/json"})
    return s


# --- RFM tiering --- #
class TestRfm:
    def test_top_customers_eager_caches_with_tier(self, mgr):
        r = mgr.get(f"{API}/bi/top-customers", params={"date_from": "2020-01-01", "date_to": "2026-12-31", "limit": 2000})
        assert r.status_code == 200
        # Now the customer profile must have rfm_tier
        r2 = mgr.get(f"{API}/bi/customer/{JANET}")
        assert r2.status_code == 200
        prof = r2.json()["profile"]
        assert prof.get("rfm_tier") in {"vip", "loyal", "promising", "at_risk", "churned", "new"}, prof


# --- Daily call list --- #
class TestCallList:
    def test_call_list_shape_mgr(self, mgr):
        r = mgr.get(f"{API}/dashboard/call-list")
        assert r.status_code == 200
        d = r.json()
        for k in ("date", "anniversaries", "at_risk", "vip_silent", "churned"):
            assert k in d, f"missing {k}"
        # at_risk + churned should typically be non-empty given 2k cached
        for row in d["at_risk"][:1]:
            assert row.get("rfm_tier") == "at_risk"
            assert "customer_name" in row
            assert "total_sales" in row
        for row in d["churned"][:1]:
            assert row.get("rfm_tier") == "churned"

    def test_call_list_assoc_allowed(self, assoc):
        r = assoc.get(f"{API}/dashboard/call-list")
        assert r.status_code == 200

    def test_call_list_unauth(self):
        r = requests.get(f"{API}/dashboard/call-list")
        assert r.status_code == 401


# --- Attribution --- #
class TestAttribution:
    def test_attribution_mgr(self, mgr):
        r = mgr.get(f"{API}/dashboard/attribution", params={"days": 30})
        assert r.status_code == 200
        d = r.json()
        for k in ("window_days", "messaged_customers", "purchased_within_window",
                 "estimated_revenue_kes", "conversion_rate", "by_associate", "method"):
            assert k in d, f"missing {k}"
        assert d["window_days"] == 30
        assert isinstance(d["by_associate"], list)
        if d["by_associate"]:
            row = d["by_associate"][0]
            for k in ("associate", "messages", "customers_contacted", "customers_purchased", "conversion_rate"):
                assert k in row

    def test_attribution_assoc_forbidden(self, assoc):
        r = assoc.get(f"{API}/dashboard/attribution", params={"days": 30})
        assert r.status_code == 403


# --- NBA --- #
class TestNba:
    def test_nba_janet_mgr(self, mgr):
        r = mgr.get(f"{API}/customers/{JANET}/nba", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("action") in {"call", "message", "wait", "lookbook", "invite"}
        assert d.get("urgency") in {"high", "medium", "low"}
        assert isinstance(d.get("why"), str)
        assert isinstance(d.get("script"), str)

    def test_nba_cache_hit_fast(self, mgr):
        # Second call should be served from cache → very fast
        t0 = time.time()
        r = mgr.get(f"{API}/customers/{JANET}/nba", timeout=10)
        assert r.status_code == 200
        elapsed = time.time() - t0
        assert elapsed < 3.0, f"second NBA call took {elapsed}s, cache likely not hit"

    def test_nba_assoc_allowed(self, assoc):
        r = assoc.get(f"{API}/customers/{JANET}/nba", timeout=10)
        assert r.status_code == 200

    def test_nba_unauth(self):
        r = requests.get(f"{API}/customers/{JANET}/nba")
        assert r.status_code == 401


# --- Forget customer --- #
class TestForget:
    @pytest.fixture(scope="class")
    def fixture_cid(self, mgr):
        cid = f"test-forget-{uuid.uuid4().hex[:8]}"
        # seed cache
        # Insert via /preferences (has upsert), /notes, /tasks, /messages
        mgr.put(f"{API}/preferences/{cid}", json={"sizes": {"top": "M"}, "fits": ["slim"]})
        mgr.post(f"{API}/notes", json={"customer_id": cid, "body": "TEST_forget note"})
        mgr.post(f"{API}/tasks", json={"customer_id": cid, "title": "TEST_forget task", "due_date": "2026-12-01"})
        mgr.post(f"{API}/messages", json={"customer_id": cid, "channel": "whatsapp", "body": "hi forget"})
        return cid

    def test_forget_assoc_forbidden(self, assoc, fixture_cid):
        r = assoc.post(f"{API}/customers/{fixture_cid}/forget")
        assert r.status_code == 403

    def test_forget_mgr_redacts(self, mgr, fixture_cid):
        r = mgr.post(f"{API}/customers/{fixture_cid}/forget")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["forgotten"] is True
        assert d["customer_id"] == fixture_cid
        s = d["summary"]
        for k in ("cache_deleted", "preferences_deleted", "social_handles_deleted", "nba_deleted",
                 "notes_redacted", "tasks_redacted", "messages_redacted", "lookbooks_expired",
                 "consent_recorded_optout", "social_feedback_unlinked"):
            assert k in s, f"missing summary.{k}"
        assert s["preferences_deleted"] >= 1
        assert s["notes_redacted"] >= 1
        assert s["tasks_redacted"] >= 1
        assert s["messages_redacted"] >= 1

        # Verify redaction: notes body should be [redacted]
        r2 = mgr.get(f"{API}/notes", params={"customer_id": fixture_cid})
        assert r2.status_code == 200
        for n in r2.json():
            assert n["body"] == "[redacted]"

        # audit log
        r3 = mgr.get(f"{API}/audit")
        assert r3.status_code == 200
        events = r3.json()
        assert any(ev.get("action") == "customer.forget" and ev.get("target_id") == fixture_cid for ev in events)


# --- Anniversaries --- #
class TestAnniversaries:
    def test_run_assoc_forbidden(self, assoc):
        r = assoc.post(f"{API}/anniversaries/run")
        assert r.status_code == 403

    def test_run_mgr_idempotent(self, mgr):
        r1 = mgr.post(f"{API}/anniversaries/run")
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        # first call: either fresh or already_run
        assert "tasks_created" in d1 or d1.get("already_run") is True
        # second call must be already_run=true
        r2 = mgr.post(f"{API}/anniversaries/run")
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("already_run") is True
        assert d2.get("tasks_created") == 0
