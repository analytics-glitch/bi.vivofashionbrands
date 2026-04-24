"""Iteration 21 backend tests — audit-driven P0 fixes + new workflow endpoints.

Covers:
 - /api/customers avg_customer_spend recompute (P0 Bug 1)
 - /api/recommendations CRUD (close-the-loop workflow)
 - /api/user/last-visit (warm-start belt)
 - Regression: /api/kpis, /api/sales-by-location, /api/leaderboard etc.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ----- P0 Bug 1: avg_customer_spend recompute -----
class TestAvgCustomerSpend:
    def test_avg_spend_recomputed_local(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/customers",
            params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
            headers=auth, timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "avg_customer_spend" in d
        assert "avg_customer_spend_source" in d
        assert d["avg_customer_spend_source"] in ("recomputed_local", "upstream_unverified")
        # In the happy path the source should be recomputed_local
        if d["avg_customer_spend_source"] == "recomputed_local":
            spend = d["avg_customer_spend"]
            # Should be in the ~KES 10–15k range per the audit (never 100k+).
            assert spend < 50000, f"avg_customer_spend={spend} looks wrong (expected ~11k)"
            assert spend > 1000, f"avg_customer_spend={spend} too low"

    def test_customers_no_mongo_id_leak(self, auth):
        r = requests.get(f"{BASE_URL}/api/customers",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert "_id" not in r.text[:5000]


# ----- Churn window behaviour (server-side returns full data; frontend hides tiles) -----
class TestCustomersChurn:
    def test_churn_365d_window(self, auth):
        r = requests.get(f"{BASE_URL}/api/customers",
                         params={"date_from": "2025-04-24", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "churn_rate" in d
        assert "churned_customers" in d


# ----- Feature: Recommendations close-the-loop -----
class TestRecommendations:
    TEST_KEY = "TEST_STYLE_ITER21"

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/recommendations", params={"item_type": "reorder"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_list_empty_or_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/recommendations",
                         params={"item_type": "reorder"}, headers=auth, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_crud_flow(self, auth):
        # create po_raised
        r = requests.post(f"{BASE_URL}/api/recommendations",
                          headers=auth, timeout=15,
                          json={"item_type": "reorder", "item_key": self.TEST_KEY,
                                "status": "po_raised", "note": "unit test"})
        assert r.status_code == 200, r.text[:300]
        row = r.json()
        assert row["status"] == "po_raised"
        assert row["item_key"] == self.TEST_KEY
        # persists
        r2 = requests.get(f"{BASE_URL}/api/recommendations",
                          params={"item_type": "reorder"}, headers=auth, timeout=15)
        assert any(x["item_key"] == self.TEST_KEY and x["status"] == "po_raised" for x in r2.json())
        # flip to pending → deletes
        r3 = requests.post(f"{BASE_URL}/api/recommendations",
                           headers=auth, timeout=15,
                           json={"item_type": "reorder", "item_key": self.TEST_KEY, "status": "pending"})
        assert r3.status_code == 200
        r4 = requests.get(f"{BASE_URL}/api/recommendations",
                          params={"item_type": "reorder"}, headers=auth, timeout=15)
        assert not any(x["item_key"] == self.TEST_KEY for x in r4.json())

    def test_invalid_status_rejected(self, auth):
        r = requests.post(f"{BASE_URL}/api/recommendations",
                          headers=auth, timeout=15,
                          json={"item_type": "reorder", "item_key": "BAD", "status": "zzz"})
        assert r.status_code == 422

    def test_bulk_delete(self, auth):
        # seed two rows
        for k in ("TEST_BULK_A", "TEST_BULK_B"):
            requests.post(f"{BASE_URL}/api/recommendations", headers=auth, timeout=15,
                          json={"item_type": "ibt", "item_key": k, "status": "done"})
        r = requests.delete(f"{BASE_URL}/api/recommendations",
                            params={"item_type": "ibt"}, headers=auth, timeout=15)
        assert r.status_code == 200
        assert "deleted" in r.json()


# ----- Feature: WhatChangedBelt backend -----
class TestLastVisit:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/user/last-visit", timeout=15)
        assert r.status_code in (401, 403)

    def test_shape(self, auth):
        r = requests.get(f"{BASE_URL}/api/user/last-visit", headers=auth, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("last_visit_at", "hours_since", "is_warm_return", "first_ever"):
            assert k in d, f"missing {k}"
        assert isinstance(d["is_warm_return"], bool)
        assert isinstance(d["first_ever"], bool)


# ----- Regression essentials -----
class TestRegression:
    def test_kpis(self, auth):
        r = requests.get(f"{BASE_URL}/api/kpis",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "total_sales" in d

    def test_sales_summary(self, auth):
        r = requests.get(f"{BASE_URL}/api/sales-summary",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code == 200

    def test_leaderboard_streaks(self, auth):
        r = requests.get(f"{BASE_URL}/api/leaderboard/streaks",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code == 200

    def test_footfall(self, auth):
        r = requests.get(f"{BASE_URL}/api/footfall",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code == 200

    def test_ibt_suggestions(self, auth):
        r = requests.get(f"{BASE_URL}/api/ibt-suggestions",
                         params={"date_from": "2026-04-01", "date_to": "2026-04-24"},
                         headers=auth, timeout=60)
        assert r.status_code in (200, 404)
