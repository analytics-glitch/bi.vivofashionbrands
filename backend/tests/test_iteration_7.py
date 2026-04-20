"""Iteration 7 backend tests - Vivo BI Dashboard v7 redesign endpoints."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://bi-platform-2.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- /api/analytics/active-pos ----
class TestActivePOS:
    def test_active_pos_returns_list(self, client):
        r = client.get(f"{API}/analytics/active-pos", timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_active_pos_no_warehouse_or_online(self, client):
        r = client.get(f"{API}/analytics/active-pos", timeout=60)
        data = r.json()
        for loc in data:
            ch = (loc.get("channel") or "").lower()
            assert "warehouse" not in ch, f"Warehouse leaked: {loc.get('channel')}"
            assert "online" not in ch, f"Online leaked: {loc.get('channel')}"
            assert "third-party" not in ch, f"Third-party leaked: {loc.get('channel')}"
            assert "finished goods" not in ch, f"Finished-goods leaked: {loc.get('channel')}"


# ---- /api/analytics/stock-to-sales-by-subcat ----
class TestSTSbySubcat:
    def test_sts_by_subcat_schema(self, client):
        r = client.get(f"{API}/analytics/stock-to-sales-by-subcat", timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        row = data[0]
        for k in ("subcategory", "units_sold", "current_stock",
                  "pct_of_total_sold", "pct_of_total_stock", "variance"):
            assert k in row, f"missing key {k}"
        # variance = pct_sold - pct_stock
        assert abs(row["variance"] - (row["pct_of_total_sold"] - row["pct_of_total_stock"])) < 1e-6


# ---- /api/analytics/stock-to-sales-by-category ----
class TestSTSbyCategory:
    def test_sts_by_category_rollup(self, client):
        r = client.get(f"{API}/analytics/stock-to-sales-by-category", timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        cats = {row["category"] for row in data}
        # At least one of the canonical categories should be there
        assert cats & {"Dresses", "Tops", "Bottoms", "Outerwear", "Sets & Bodysuits", "Accessories"}, \
            f"No canonical categories; got {cats}"
        row = data[0]
        for k in ("category", "units_sold", "current_stock",
                  "pct_of_total_sold", "pct_of_total_stock", "variance"):
            assert k in row


# ---- /api/analytics/weeks-of-cover ----
class TestWeeksOfCover:
    def test_weeks_of_cover_schema(self, client):
        r = client.get(f"{API}/analytics/weeks-of-cover", timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        row = data[0]
        for k in ("style_name", "current_stock", "units_sold_28d",
                  "avg_weekly_sales", "weeks_of_cover"):
            assert k in row


# ---- /api/subcategory-sales ----
class TestSubcategorySales:
    def test_one_row_per_subcat(self, client):
        r = client.get(f"{API}/subcategory-sales", timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        subs = [row.get("subcategory") for row in data]
        assert len(subs) == len(set(subs)), "Duplicate subcategories found"


# ---- Regression: core KPIs still work ----
class TestRegression:
    def test_kpis(self, client):
        r = client.get(f"{API}/kpis", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "total_sales" in d or "total_orders" in d

    def test_top_skus(self, client):
        r = client.get(f"{API}/top-skus", params={"limit": 20}, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_footfall(self, client):
        r = client.get(f"{API}/footfall", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_inventory_summary(self, client):
        r = client.get(f"{API}/analytics/inventory-summary", timeout=90)
        assert r.status_code == 200
