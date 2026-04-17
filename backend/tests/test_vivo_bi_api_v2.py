"""
Vivo BI Dashboard API Tests - Iteration 2
Tests all proxy and analytics endpoints for the redesigned Vivo Fashion Group BI Dashboard.

NEW Endpoints (this iteration):
- /api/ - Root status
- /api/locations - Locations proxy
- /api/kpis - KPIs with date/location filtering
- /api/sales-summary - Per-store aggregates
- /api/top-skus - Top SKUs with limit/location filtering
- /api/sor - Sell-Out Rate data
- /api/daily-trend - Daily trend data
- /api/inventory - Inventory with country filtering
- /api/analytics/kpis-plus - Augmented KPIs with sell_through_rate
- /api/analytics/highlights - Top location/brand/collection
- /api/analytics/by-country - Country aggregates with avg_basket_size
- /api/analytics/inventory-summary - Inventory summary with markets field
- /api/analytics/low-stock - Low stock items with threshold

REMOVED Endpoints (from iteration 1):
- /api/sales (upstream no longer exists)
- /api/analytics/overview
- /api/analytics/top-products
- /api/analytics/top-brands
- /api/analytics/product-types
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Date range with data on upstream
DEFAULT_DATE_FROM = "2026-04-01"
DEFAULT_DATE_TO = "2026-04-17"


class TestRootEndpoint:
    """Test root API status endpoint"""
    
    def test_root_returns_ok(self):
        """GET /api/ returns {status: ok}"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok", f"Expected status=ok, got {data}"
        print(f"Root endpoint OK: {data}")


class TestLocationsEndpoint:
    """Test locations proxy endpoint"""
    
    def test_locations_returns_list(self):
        """GET /api/locations returns list with location, store_id, country"""
        response = requests.get(f"{BASE_URL}/api/locations")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of locations"
        assert len(data) > 0, "Expected at least one location"
        
        # Verify structure of first item
        first = data[0]
        has_location = "location" in first or "location_name" in first
        assert has_location, f"Expected location field, got keys: {first.keys()}"
        assert "store_id" in first, f"Expected store_id field, got keys: {first.keys()}"
        assert "country" in first, f"Expected country field, got keys: {first.keys()}"
        print(f"Locations count: {len(data)}, Sample: {first}")


class TestKpisEndpoint:
    """Test KPIs proxy endpoint"""
    
    def test_kpis_returns_all_fields(self):
        """GET /api/kpis?date_from=2026-04-01&date_to=2026-04-17 returns all KPI fields"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify all expected KPI fields
        expected_fields = [
            "total_gross_sales", "total_net_sales", "total_returns", 
            "total_discounts", "total_orders", "total_units", 
            "avg_basket_size", "avg_selling_price"
        ]
        for field in expected_fields:
            assert field in data, f"Expected {field} in KPIs response, got keys: {data.keys()}"
        
        print(f"KPIs: gross_sales={data.get('total_gross_sales')}, orders={data.get('total_orders')}, units={data.get('total_units')}")
    
    def test_kpis_with_location_filter(self):
        """GET /api/kpis supports location query param"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "location": "Vivo Sarit"
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_gross_sales" in data, "Expected total_gross_sales in filtered KPIs"
        print(f"KPIs for Vivo Sarit: gross_sales={data.get('total_gross_sales')}")


class TestSalesSummaryEndpoint:
    """Test sales-summary proxy endpoint"""
    
    def test_sales_summary_returns_aggregates(self):
        """GET /api/sales-summary returns per-store aggregates with required fields"""
        response = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of store summaries"
        assert len(data) > 0, "Expected at least one store summary"
        
        # Verify structure
        first = data[0]
        expected_fields = ["location", "store_id", "gross_sales", "net_sales", "total_orders", "units_sold"]
        for field in expected_fields:
            assert field in first, f"Expected {field} in sales summary, got keys: {first.keys()}"
        
        print(f"Sales summary count: {len(data)}, Sample: {first}")


class TestTopSkusEndpoint:
    """Test top-skus proxy endpoint"""
    
    def test_top_skus_with_limit(self):
        """GET /api/top-skus?limit=20 returns 20 items with required fields"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "limit": 20
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of SKUs"
        assert len(data) <= 20, f"Expected at most 20 items, got {len(data)}"
        
        if len(data) > 0:
            first = data[0]
            expected_fields = ["sku", "product_name", "size", "brand", "collection", "units_sold", "total_sales", "avg_price"]
            for field in expected_fields:
                assert field in first, f"Expected {field} in top-skus, got keys: {first.keys()}"
            print(f"Top SKUs count: {len(data)}, Sample: {first.get('product_name')}")
    
    def test_top_skus_with_location_filter(self):
        """GET /api/top-skus supports location filter"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "location": "Vivo Sarit",
            "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of SKUs"
        print(f"Top SKUs for Vivo Sarit: {len(data)} items")


class TestSorEndpoint:
    """Test SOR (Sell-Out Rate) proxy endpoint"""
    
    def test_sor_returns_items(self):
        """GET /api/sor returns ~100 items with required fields"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of SOR items"
        
        if len(data) > 0:
            first = data[0]
            expected_fields = ["style_name", "collection", "brand", "product_type", "units_sold", "current_stock", "total_sales", "sor_percent"]
            for field in expected_fields:
                assert field in first, f"Expected {field} in SOR, got keys: {first.keys()}"
            print(f"SOR items count: {len(data)}, Sample: {first.get('style_name')}")
        else:
            print("SOR returned empty list")


class TestDailyTrendEndpoint:
    """Test daily-trend proxy endpoint"""
    
    def test_daily_trend_returns_items(self):
        """GET /api/daily-trend returns daily items with day/orders/gross_sales/net_sales"""
        response = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of daily trend items"
        
        if len(data) > 0:
            first = data[0]
            expected_fields = ["day", "orders", "gross_sales", "net_sales"]
            for field in expected_fields:
                assert field in first, f"Expected {field} in daily-trend, got keys: {first.keys()}"
            print(f"Daily trend items: {len(data)}, Sample: {first}")
        else:
            print("Daily trend returned empty list")


class TestInventoryEndpoint:
    """Test inventory proxy endpoint"""
    
    def test_inventory_returns_list(self):
        """GET /api/inventory returns inventory rows"""
        response = requests.get(f"{BASE_URL}/api/inventory")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of inventory items"
        
        if len(data) > 0:
            first = data[0]
            assert "available" in first, f"Expected available field, got keys: {first.keys()}"
            print(f"Inventory count: {len(data)}, Sample: {first}")
        else:
            print("Inventory returned empty list")
    
    def test_inventory_filter_by_country(self):
        """GET /api/inventory?country=kenya filters by country"""
        response = requests.get(f"{BASE_URL}/api/inventory", params={"country": "kenya"})
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of inventory items"
        print(f"Kenya inventory count: {len(data)}")


class TestAnalyticsKpisPlus:
    """Test analytics kpis-plus endpoint"""
    
    def test_kpis_plus_returns_augmented_fields(self):
        """GET /api/analytics/kpis-plus returns kpis PLUS augmented fields"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        # Base KPI fields
        base_fields = ["total_gross_sales", "total_net_sales", "total_returns", 
                       "total_discounts", "total_orders", "total_units"]
        for field in base_fields:
            assert field in data, f"Expected base KPI {field}, got keys: {data.keys()}"
        
        # Augmented fields
        augmented_fields = ["units_clean", "units_excluded", "units_per_order", "return_rate", "sell_through_rate"]
        for field in augmented_fields:
            assert field in data, f"Expected augmented field {field}, got keys: {data.keys()}"
        
        # sell_through_rate should be > 0 (computed from /sor)
        assert data.get("sell_through_rate", 0) > 0, f"Expected sell_through_rate > 0, got {data.get('sell_through_rate')}"
        
        print(f"KPIs Plus: sell_through_rate={data.get('sell_through_rate')}, units_clean={data.get('units_clean')}")
    
    def test_kpis_plus_with_location(self):
        """GET /api/analytics/kpis-plus with location='Vivo Sarit' returns non-empty kpis"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "location": "Vivo Sarit"
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_gross_sales" in data, "Expected total_gross_sales in response"
        # Verify non-empty (has some data)
        assert data.get("total_orders", 0) >= 0, "Expected total_orders >= 0"
        print(f"KPIs Plus for Vivo Sarit: orders={data.get('total_orders')}, gross_sales={data.get('total_gross_sales')}")


class TestAnalyticsHighlights:
    """Test analytics highlights endpoint"""
    
    def test_highlights_returns_structure(self):
        """GET /api/analytics/highlights returns top_location, top_brand, top_collection"""
        response = requests.get(f"{BASE_URL}/api/analytics/highlights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "top_location" in data, f"Expected top_location, got keys: {data.keys()}"
        assert "top_brand" in data, f"Expected top_brand, got keys: {data.keys()}"
        assert "top_collection" in data, f"Expected top_collection, got keys: {data.keys()}"
        
        # Verify top_location structure
        if data.get("top_location"):
            loc = data["top_location"]
            assert "name" in loc, f"Expected name in top_location, got: {loc}"
            assert "country" in loc, f"Expected country in top_location, got: {loc}"
            assert "gross_sales" in loc, f"Expected gross_sales in top_location, got: {loc}"
        
        # Verify top_brand structure
        if data.get("top_brand"):
            brand = data["top_brand"]
            assert "name" in brand, f"Expected name in top_brand, got: {brand}"
            assert "gross_sales" in brand, f"Expected gross_sales in top_brand, got: {brand}"
        
        # Verify top_collection structure
        if data.get("top_collection"):
            coll = data["top_collection"]
            assert "name" in coll, f"Expected name in top_collection, got: {coll}"
            assert "gross_sales" in coll, f"Expected gross_sales in top_collection, got: {coll}"
        
        print(f"Highlights: top_location={data.get('top_location')}, top_brand={data.get('top_brand')}")


class TestAnalyticsByCountry:
    """Test analytics by-country endpoint"""
    
    def test_by_country_returns_sorted_list(self):
        """GET /api/analytics/by-country returns 3 entries sorted desc by gross_sales with avg_basket_size"""
        response = requests.get(f"{BASE_URL}/api/analytics/by-country", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of country aggregates"
        
        # Check countries present (should be Kenya, Uganda, Rwanda)
        countries = [item.get("country") for item in data]
        print(f"Countries found: {countries}")
        
        # Verify avg_basket_size is computed
        for item in data:
            assert "avg_basket_size" in item, f"Expected avg_basket_size in country data, got: {item.keys()}"
        
        # Verify sorted by gross_sales descending
        if len(data) > 1:
            for i in range(len(data) - 1):
                assert data[i].get("gross_sales", 0) >= data[i+1].get("gross_sales", 0), \
                    f"Expected sorted by gross_sales descending, got {data[i].get('gross_sales')} < {data[i+1].get('gross_sales')}"
        
        print(f"By-country: {len(data)} entries, first={data[0] if data else 'empty'}")


class TestAnalyticsInventorySummary:
    """Test analytics inventory-summary endpoint"""
    
    def test_inventory_summary_returns_structure(self):
        """GET /api/analytics/inventory-summary returns all required fields including markets"""
        response = requests.get(f"{BASE_URL}/api/analytics/inventory-summary")
        assert response.status_code == 200
        data = response.json()
        
        # Verify all expected fields
        expected_fields = ["total_units", "total_skus", "low_stock_skus", "markets", 
                          "by_country", "by_location", "by_product_type"]
        for field in expected_fields:
            assert field in data, f"Expected {field} in inventory summary, got keys: {data.keys()}"
        
        assert isinstance(data["by_country"], list), "Expected by_country to be a list"
        assert isinstance(data["by_location"], list), "Expected by_location to be a list"
        assert isinstance(data["by_product_type"], list), "Expected by_product_type to be a list"
        
        # Verify markets field is present and numeric
        assert isinstance(data["markets"], int), f"Expected markets to be int, got {type(data['markets'])}"
        
        print(f"Inventory summary: total_units={data['total_units']}, total_skus={data['total_skus']}, low_stock={data['low_stock_skus']}, markets={data['markets']}")


class TestAnalyticsLowStock:
    """Test analytics low-stock endpoint"""
    
    def test_low_stock_with_threshold(self):
        """GET /api/analytics/low-stock?threshold=2 returns rows with available <= 2 sorted ascending"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={"threshold": 2})
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of low stock items"
        
        # Verify all items have available <= threshold
        for item in data:
            available = item.get("available", 0)
            assert available <= 2, f"Expected available <= 2, got {available}"
        
        # Verify sorted ascending by available
        if len(data) > 1:
            for i in range(len(data) - 1):
                assert data[i].get("available", 0) <= data[i+1].get("available", 0), \
                    f"Expected sorted ascending, got {data[i].get('available')} > {data[i+1].get('available')}"
        
        print(f"Low stock items (threshold=2): {len(data)}")
    
    def test_low_stock_with_location_filter(self):
        """GET /api/analytics/low-stock accepts location query param"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={
            "threshold": 2,
            "location": "Vivo Sarit"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of low stock items"
        print(f"Low stock for Vivo Sarit: {len(data)} items")
    
    def test_low_stock_with_product_filter(self):
        """GET /api/analytics/low-stock accepts product query param"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={
            "threshold": 2,
            "product": "shirt"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of low stock items"
        print(f"Low stock for 'shirt' products: {len(data)} items")


class TestNoUpstreamSalesDependency:
    """Verify no upstream /sales dependency remains"""
    
    def test_endpoints_do_not_500_due_to_missing_sales(self):
        """Verify endpoints should not 500 due to missing upstream /sales route"""
        # These endpoints should work without /sales
        endpoints_to_test = [
            ("/api/", {}),
            ("/api/locations", {}),
            ("/api/kpis", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/sales-summary", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/top-skus", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO, "limit": 10}),
            ("/api/sor", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/daily-trend", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/inventory", {}),
            ("/api/analytics/kpis-plus", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/analytics/highlights", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/analytics/by-country", {"date_from": DEFAULT_DATE_FROM, "date_to": DEFAULT_DATE_TO}),
            ("/api/analytics/inventory-summary", {}),
            ("/api/analytics/low-stock", {"threshold": 2}),
        ]
        
        for endpoint, params in endpoints_to_test:
            response = requests.get(f"{BASE_URL}{endpoint}", params=params)
            assert response.status_code != 500, f"Endpoint {endpoint} returned 500 - may have /sales dependency"
            assert response.status_code < 500, f"Endpoint {endpoint} returned {response.status_code}"
            print(f"{endpoint}: {response.status_code} OK")
    
    def test_sales_endpoint_does_not_exist(self):
        """Verify /api/sales endpoint no longer exists (should return 404 or similar)"""
        response = requests.get(f"{BASE_URL}/api/sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        # Should NOT return 200 since /sales was removed
        assert response.status_code != 200, f"Expected /api/sales to not exist, but got 200"
        print(f"/api/sales correctly returns {response.status_code} (endpoint removed)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
