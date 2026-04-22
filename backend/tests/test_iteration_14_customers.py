"""Iteration 14 tests: new customer proxy endpoints + data-freshness + inventory locations filter.

Endpoints under test (per review_request):
  GET /api/top-customers
  GET /api/customer-search?q=test
  GET /api/churned-customers
  GET /api/customer-frequency
  GET /api/customers-by-location
  GET /api/new-customer-products
  GET /api/customer-products?customer_id=<id>
  GET /api/data-freshness
  GET /api/analytics/inventory-summary?locations=Vivo%20Sarit

Upstream returning 500 on /top-customers and /churned-customers is expected;
our proxies must catch it and return an empty JSON list (HTTP 200).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
TIMEOUT = 45

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        pytest.skip(f"auth failed: {r.status_code} {r.text[:200]}")
    return r.json().get("token")


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ---------- customer proxy endpoints ----------
class TestCustomerEndpoints:
    def test_top_customers(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/top-customers", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list), f"expected list got {type(body)}"

    def test_customer_search(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/customer-search", params={"q": "test"}, headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_customer_search_empty_query(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/customer-search", params={"q": ""}, headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == []

    def test_churned_customers(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/churned-customers", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_customer_frequency(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/customer-frequency", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)

    def test_customers_by_location(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/customers-by-location", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_new_customer_products(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/new-customer-products", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_customer_products_requires_id(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/customer-products", params={"customer_id": "1"}, headers=auth_headers, timeout=TIMEOUT)
        # 200 with list (possibly empty) or upstream falling back to []
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# ---------- data freshness ----------
class TestDataFreshness:
    def test_data_freshness(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/data-freshness", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("last_sale_date", "last_odoo_extract_at", "last_bigquery_load_at",
                  "next_scheduled_run_at", "sla_hours", "etl_cadence"):
            assert k in body, f"missing key {k} in {body}"
        assert body["sla_hours"] == 6
        assert isinstance(body["etl_cadence"], str) and body["etl_cadence"]


# ---------- inventory locations filter ----------
class TestInventoryLocationFilter:
    def test_inventory_summary_vivo_sarit(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/analytics/inventory-summary",
            params={"locations": "Vivo Sarit"},
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Should return either a dict with summary or list. Must be JSON-serializable.
        assert body is not None

    def test_inventory_summary_no_filter(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/analytics/inventory-summary",
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
