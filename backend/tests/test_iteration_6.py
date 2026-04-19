"""Iteration 6 tests: new /analytics/new-styles endpoint + regression checks."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")

DATE_FROM = "2026-04-01"
DATE_TO = "2026-04-18"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- NEW: /api/analytics/new-styles ----------
class TestNewStyles:
    EXPECTED_FIELDS = {
        "style_name", "units_sold_period", "total_sales_period",
        "units_sold_launch", "total_sales_launch", "current_stock", "sor_percent",
    }

    def test_new_styles_basic(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/new-styles",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO}, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # If non-empty, validate fields
        if data:
            first = data[0]
            missing = self.EXPECTED_FIELDS - set(first.keys())
            assert not missing, f"Missing fields: {missing}; got {list(first.keys())}"
            # sort check: descending total_sales_period
            sales = [x.get("total_sales_period") or 0 for x in data]
            assert sales == sorted(sales, reverse=True)
            # data types
            assert isinstance(first["style_name"], str)
            assert isinstance(first["sor_percent"], (int, float))

    def test_new_styles_country_filter(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/new-styles",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO, "country": "Kenya"},
                       timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert self.EXPECTED_FIELDS.issubset(set(data[0].keys()))


# ---------- Regression ----------
class TestRegression:
    def test_footfall(self, client):
        r = client.get(f"{BASE_URL}/api/footfall",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        row = data[0]
        for f in ("location", "total_footfall", "orders", "conversion_rate"):
            assert f in row, f"footfall row missing {f}: {row.keys()}"

    def test_kpis(self, client):
        r = client.get(f"{BASE_URL}/api/kpis",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        for f in ("total_sales", "total_orders", "total_units"):
            assert f in data
        assert data["total_sales"] > 0

    def test_inventory_summary(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/inventory-summary", timeout=60)
        assert r.status_code == 200
        data = r.json()
        for f in ("total_units", "total_skus", "low_stock_skus", "by_country", "by_location", "by_product_type"):
            assert f in data

    def test_stock_to_sales(self, client):
        r = client.get(f"{BASE_URL}/api/stock-to-sales",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO}, timeout=60)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_subcategory_stock_sales(self, client):
        r = client.get(f"{BASE_URL}/api/subcategory-stock-sales",
                       params={"date_from": DATE_FROM, "date_to": DATE_TO}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
