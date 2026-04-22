"""Iteration 15 backend tests: sales-projection, ibt-suggestions, customer-crosswalk, churn_rate sanity."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"

WAREHOUSES = {"Warehouse Finished Goods", "Warehouse", "Vivo Warehouse", "Shop Zetu Warehouse"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------- Sales Projection ----------------------------
class TestSalesProjection:
    def test_sales_projection_basic(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sales-projection",
            params={"date_from": "2026-04-01", "date_to": "2026-04-30"},
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("actual_sales", "daily_run_rate", "projected_sales",
                  "completion_pct", "days_elapsed", "total_days"):
            assert k in data, f"Missing key {k} in {data}"
        assert data["total_days"] == 30
        assert 0 <= data["completion_pct"] <= 100
        # Run-rate sanity: projected ≈ daily_run_rate * total_days
        assert abs(data["projected_sales"] - data["daily_run_rate"] * data["total_days"]) < 1

    def test_sales_projection_invalid_date(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/sales-projection",
            params={"date_from": "bad", "date_to": "2026-04-30"},
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 400


# ------------------------- IBT Suggestions ----------------------------
class TestIBTSuggestions:
    def test_ibt_returns_list_excludes_warehouses(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/ibt-suggestions",
            params={"date_from": "2026-04-01", "date_to": "2026-04-22", "limit": 5},
            headers=auth_headers,
            timeout=180,  # expensive, can take 60-90s
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 5
        for s in data:
            for k in ("style_name", "from_store", "to_store", "units_to_move", "estimated_uplift"):
                assert k in s, f"Missing {k} in suggestion {s}"
            assert s["from_store"] not in WAREHOUSES
            assert s["to_store"] not in WAREHOUSES
            assert s["from_store"] != s["to_store"]
            assert s["units_to_move"] >= 1


# ------------------------- Customer Crosswalk ----------------------------
class TestCustomerCrosswalk:
    def test_crosswalk_structure(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/analytics/customer-crosswalk",
            params={"date_from": "2026-04-01", "date_to": "2026-04-22", "top": 5},
            headers=auth_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 5
        for row in data:
            for k in ("store_a", "store_b", "shared_customers", "pct_overlap"):
                assert k in row
            assert 0 <= row["pct_overlap"] <= 100
            assert row["shared_customers"] >= 1


# ------------------------- Churn Rate Sanitisation ----------------------------
class TestCustomersChurn:
    def test_churn_rate_in_range(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/customers",
            params={"date_from": "2026-04-01", "date_to": "2026-04-22"},
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        cr = data.get("churn_rate")
        assert cr is not None, f"churn_rate missing: {data}"
        assert 0 <= cr <= 100, f"churn_rate out of range: {cr}"
