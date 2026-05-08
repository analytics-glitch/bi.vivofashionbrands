"""Iter9 — cohort drill-down + social platforms backend regression."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MGR = "test_session_vivo_mgr_1778250692444"
ASSOC = "test_session_vivo_assoc_1778250692444"


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- Cohort drill-down ---
class TestCohortDrill:
    def test_customers_default(self):
        r = requests.get(f"{BASE_URL}/api/insights/cohorts/customers",
                         params={"cohort": "2025-05"}, headers=H(MGR), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["cohort"] == "2025-05"
        assert "count" in data and "customers" in data
        assert isinstance(data["customers"], list)
        if data["customers"]:
            c0 = data["customers"][0]
            assert "customer_id" in c0 and "rfm_tier" in c0

    def test_customers_vip_bucket(self):
        r = requests.get(f"{BASE_URL}/api/insights/cohorts/customers",
                         params={"cohort": "2025-05", "bucket": "vip"},
                         headers=H(MGR), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert all(c["rfm_tier"] == "vip" for c in data["customers"])

    def test_customers_retained_m6(self):
        r = requests.get(f"{BASE_URL}/api/insights/cohorts/customers",
                         params={"cohort": "2023-01", "bucket": "retained_m6"},
                         headers=H(MGR), timeout=30)
        assert r.status_code == 200

    def test_associate_forbidden_on_bulk(self):
        r = requests.post(f"{BASE_URL}/api/insights/cohorts/bulk-task",
                          json={"cohort": "2025-05", "title": "TEST_assoc"},
                          headers=H(ASSOC), timeout=30)
        assert r.status_code == 403

    def test_bulk_missing_title(self):
        r = requests.post(f"{BASE_URL}/api/insights/cohorts/bulk-task",
                          json={"cohort": "2025-05"}, headers=H(MGR), timeout=30)
        assert r.status_code in (400, 422)

    def test_bulk_create_vip(self):
        r = requests.post(f"{BASE_URL}/api/insights/cohorts/bulk-task",
                          json={"cohort": "2025-05", "bucket": "vip",
                                "title": "TEST_iter9 win-back"},
                          headers=H(MGR), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "created" in data and data["cohort"] == "2025-05"
        assert data["bucket"] == "vip"


# --- Social platforms ---
class TestSocialPlatforms:
    def test_status_lists_four(self):
        r = requests.get(f"{BASE_URL}/api/social/platforms/status",
                         headers=H(MGR), timeout=30)
        assert r.status_code == 200
        data = r.json()
        platforms = [p["platform"] for p in data]
        for p in ["instagram", "x", "tiktok", "snapchat"]:
            assert p in platforms
        sample = data[0]
        for k in ("platform", "label", "scopes", "docs_url", "token_hint", "connected"):
            assert k in sample

    def test_associate_forbidden(self):
        r = requests.get(f"{BASE_URL}/api/social/platforms/status",
                         headers=H(ASSOC), timeout=30)
        assert r.status_code == 403

    def test_connect_unknown_404(self):
        r = requests.post(f"{BASE_URL}/api/social/platforms/notreal/connect",
                          json={"access_token": "x"}, headers=H(MGR), timeout=30)
        assert r.status_code == 404

    def test_connect_requires_token(self):
        r = requests.post(f"{BASE_URL}/api/social/platforms/instagram/connect",
                          json={}, headers=H(MGR), timeout=30)
        assert r.status_code in (400, 422)

    def test_connect_disconnect_flow(self):
        # Connect
        r = requests.post(f"{BASE_URL}/api/social/platforms/tiktok/connect",
                          json={"access_token": "TEST_token_iter9", "handle": "TEST_handle"},
                          headers=H(MGR), timeout=30)
        assert r.status_code == 200, r.text

        # Verify status
        r2 = requests.get(f"{BASE_URL}/api/social/platforms/status",
                          headers=H(MGR), timeout=30)
        tt = next((p for p in r2.json() if p["platform"] == "tiktok"), None)
        assert tt and tt["connected"] is True

        # Sync should now succeed pending_implementation
        rs = requests.post(f"{BASE_URL}/api/social/platforms/tiktok/sync",
                           headers=H(MGR), timeout=30)
        assert rs.status_code == 200
        sd = rs.json()
        assert sd["status"] == "pending_implementation"
        assert sd["has_token"] is True

        # Disconnect
        rd = requests.delete(f"{BASE_URL}/api/social/platforms/tiktok",
                             headers=H(MGR), timeout=30)
        assert rd.status_code in (200, 204)

        # Verify removed
        r3 = requests.get(f"{BASE_URL}/api/social/platforms/status",
                          headers=H(MGR), timeout=30)
        tt2 = next((p for p in r3.json() if p["platform"] == "tiktok"), None)
        assert tt2 and tt2["connected"] is False

    def test_sync_when_not_connected_400(self):
        # ensure disconnected
        requests.delete(f"{BASE_URL}/api/social/platforms/snapchat",
                        headers=H(MGR), timeout=30)
        r = requests.post(f"{BASE_URL}/api/social/platforms/snapchat/sync",
                          headers=H(MGR), timeout=30)
        assert r.status_code == 400
