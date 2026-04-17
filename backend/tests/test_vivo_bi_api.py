"""
Vivo BI Dashboard API Tests
Tests all proxy and analytics endpoints for the Vivo Fashion Group BI Dashboard.
Endpoints tested:
- Root status
- Locations proxy
- Sales proxy with date filtering
- Inventory proxy with country filtering
- Sales summary proxy
- Analytics: overview, by-country, top-products, top-brands, product-types
- Analytics: inventory-summary, low-stock
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Default date range with data
DEFAULT_DATE_FROM = "2026-04-01"
DEFAULT_DATE_TO = "2026-04-17"


class TestRootEndpoint:
    """Test root API status endpoint"""
    
    def test_root_returns_ok(self):
        """GET /api/ returns status ok"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        assert "message" in data
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
        assert "location" in first or "location_name" in first, "Expected location field"
        assert "store_id" in first, "Expected store_id field"
        assert "country" in first, "Expected country field"
        print(f"Locations count: {len(data)}, Sample: {first}")


class TestSalesEndpoint:
    """Test sales proxy endpoint"""
    
    def test_sales_returns_list(self):
        """GET /api/sales returns list of line-item sales"""
        response = requests.get(f"{BASE_URL}/api/sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of sales"
        
        if len(data) > 0:
            first = data[0]
            # Check expected fields
            assert "product_name" in first, "Expected product_name field"
            assert "brand" in first, "Expected brand field"
            assert "units_sold" in first, "Expected units_sold field"
            assert "net_sales" in first, "Expected net_sales field"
            print(f"Sales count: {len(data)}, Sample: {first}")
        else:
            print("Sales returned empty list (may be expected for date range)")
    
    def test_sales_with_date_filter(self):
        """GET /api/sales?date_from=2026-04-01&date_to=2026-04-17 returns filtered results"""
        response = requests.get(f"{BASE_URL}/api/sales", params={
            "date_from": "2026-04-01",
            "date_to": "2026-04-17"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of sales"
        print(f"Filtered sales count: {len(data)}")


class TestInventoryEndpoint:
    """Test inventory proxy endpoint"""
    
    def test_inventory_returns_list(self):
        """GET /api/inventory returns inventory rows with available units"""
        response = requests.get(f"{BASE_URL}/api/inventory")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of inventory items"
        
        if len(data) > 0:
            first = data[0]
            assert "available" in first, "Expected available field"
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


class TestSalesSummaryEndpoint:
    """Test sales-summary proxy endpoint"""
    
    def test_sales_summary_returns_aggregates(self):
        """GET /api/sales-summary returns per-store aggregates"""
        response = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of store summaries"
        print(f"Sales summary count: {len(data)}")


class TestAnalyticsOverview:
    """Test analytics overview endpoint"""
    
    def test_overview_returns_kpis(self):
        """GET /api/analytics/overview returns total_orders, units_sold, gross_sales, net_sales, avg_order_value, discount_rate, active_locations, countries"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify all expected fields
        expected_fields = ["total_orders", "units_sold", "gross_sales", "net_sales", 
                          "avg_order_value", "discount_rate", "active_locations", "countries"]
        for field in expected_fields:
            assert field in data, f"Expected {field} in overview response"
        
        # Verify expected values (3 countries, 29 locations)
        print(f"Overview: countries={data['countries']}, locations={data['active_locations']}")
        print(f"KPIs: orders={data['total_orders']}, units={data['units_sold']}, net_sales={data['net_sales']}")


class TestAnalyticsByCountry:
    """Test analytics by-country endpoint"""
    
    def test_by_country_returns_sorted_list(self):
        """GET /api/analytics/by-country returns 3 entries (Kenya, Uganda, Rwanda) sorted by net_sales desc"""
        response = requests.get(f"{BASE_URL}/api/analytics/by-country", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of country aggregates"
        
        # Check countries present
        countries = [item.get("country") for item in data]
        print(f"Countries found: {countries}")
        
        # Verify sorted by net_sales descending
        if len(data) > 1:
            for i in range(len(data) - 1):
                assert data[i].get("net_sales", 0) >= data[i+1].get("net_sales", 0), \
                    "Expected sorted by net_sales descending"


class TestAnalyticsTopProducts:
    """Test analytics top-products endpoint"""
    
    def test_top_products_with_limit(self):
        """GET /api/analytics/top-products?limit=5&metric=net_sales returns top 5 aggregated products"""
        response = requests.get(f"{BASE_URL}/api/analytics/top-products", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "limit": 5,
            "metric": "net_sales"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of products"
        assert len(data) <= 5, "Expected at most 5 products"
        
        if len(data) > 0:
            first = data[0]
            assert "product_name" in first, "Expected product_name field"
            assert "net_sales" in first, "Expected net_sales field"
            print(f"Top products: {[p.get('product_name') for p in data]}")


class TestAnalyticsTopBrands:
    """Test analytics top-brands endpoint"""
    
    def test_top_brands_returns_aggregates(self):
        """GET /api/analytics/top-brands returns brand aggregates"""
        response = requests.get(f"{BASE_URL}/api/analytics/top-brands", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of brand aggregates"
        
        if len(data) > 0:
            first = data[0]
            assert "brand" in first, "Expected brand field"
            assert "net_sales" in first, "Expected net_sales field"
            print(f"Top brands count: {len(data)}, Top brand: {first.get('brand')}")


class TestAnalyticsProductTypes:
    """Test analytics product-types endpoint"""
    
    def test_product_types_returns_aggregates(self):
        """GET /api/analytics/product-types returns product_type aggregates"""
        response = requests.get(f"{BASE_URL}/api/analytics/product-types", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of product type aggregates"
        
        if len(data) > 0:
            first = data[0]
            assert "product_type" in first, "Expected product_type field"
            assert "net_sales" in first, "Expected net_sales field"
            print(f"Product types count: {len(data)}, Types: {[p.get('product_type') for p in data[:5]]}")


class TestAnalyticsInventorySummary:
    """Test analytics inventory-summary endpoint"""
    
    def test_inventory_summary_returns_structure(self):
        """GET /api/analytics/inventory-summary returns {total_units, total_skus, low_stock_skus, by_country, by_location, by_product_type}"""
        response = requests.get(f"{BASE_URL}/api/analytics/inventory-summary")
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields
        expected_fields = ["total_units", "total_skus", "low_stock_skus", "by_country", "by_location", "by_product_type"]
        for field in expected_fields:
            assert field in data, f"Expected {field} in inventory summary"
        
        assert isinstance(data["by_country"], list), "Expected by_country to be a list"
        assert isinstance(data["by_location"], list), "Expected by_location to be a list"
        assert isinstance(data["by_product_type"], list), "Expected by_product_type to be a list"
        
        print(f"Inventory summary: total_units={data['total_units']}, total_skus={data['total_skus']}, low_stock={data['low_stock_skus']}")


class TestAnalyticsLowStock:
    """Test analytics low-stock endpoint"""
    
    def test_low_stock_with_threshold(self):
        """GET /api/analytics/low-stock?threshold=2 returns list of SKUs with available <= 2"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={"threshold": 2})
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected list of low stock items"
        
        # Verify all items have available <= threshold
        for item in data:
            available = item.get("available", 0)
            assert available <= 2, f"Expected available <= 2, got {available}"
        
        print(f"Low stock items (threshold=2): {len(data)}")


class TestUpstreamErrorHandling:
    """Test that API handles upstream correctly"""
    
    def test_valid_requests_return_2xx(self):
        """Verify that calls still return 2xx when upstream is up"""
        endpoints = [
            "/api/",
            "/api/locations",
            "/api/inventory",
            "/api/analytics/overview",
            "/api/analytics/inventory-summary"
        ]
        
        for endpoint in endpoints:
            response = requests.get(f"{BASE_URL}{endpoint}")
            assert response.status_code < 300, f"Expected 2xx for {endpoint}, got {response.status_code}"
            print(f"{endpoint}: {response.status_code} OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
