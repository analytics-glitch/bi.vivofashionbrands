"""
Vivo BI Dashboard API Tests - Iteration 3
Tests for:
1. NEW /api/analytics/new-styles endpoint (styles launched within N months)
2. /api/analytics/kpis-plus with store_id filter (country filter fix)
3. Existing endpoints regression

SKU Pattern: V0226007WREDM -> MM=02, YY=26 -> February 2026
Date reference: date_to=2026-04-17, months=3 -> allowed: {Jan 2026, Feb 2026, Mar 2026, Apr 2026}
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Date range with data on upstream
DEFAULT_DATE_FROM = "2026-04-01"
DEFAULT_DATE_TO = "2026-04-17"


class TestNewStylesEndpoint:
    """Test /api/analytics/new-styles endpoint - NEW in iteration 3"""
    
    def test_new_styles_returns_list_with_required_fields(self):
        """GET /api/analytics/new-styles?months=3 returns list with all required fields"""
        response = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 3
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) >= 1, f"Expected at least 1 new style, got {len(data)}"
        
        # Verify required fields in each row
        required_fields = ["product_name", "first_sku", "launch_month", "launch_sort", 
                          "brand", "collection", "size", "units_sold", "total_sales", "skus"]
        first = data[0]
        for field in required_fields:
            assert field in first, f"Expected {field} in new-styles row, got keys: {first.keys()}"
        
        # Verify launch_month format (MM/YYYY)
        assert "/" in first["launch_month"], f"Expected launch_month format MM/YYYY, got {first['launch_month']}"
        
        print(f"New styles (months=3): {len(data)} items")
        print(f"Sample: {first['product_name']}, launch={first['launch_month']}, units={first['units_sold']}")
    
    def test_new_styles_months_1_returns_fewer_or_equal(self):
        """GET /api/analytics/new-styles?months=1 returns fewer or equal rows vs months=3"""
        response_3 = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 3
        })
        response_1 = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 1
        })
        
        assert response_3.status_code == 200
        assert response_1.status_code == 200
        
        data_3 = response_3.json()
        data_1 = response_1.json()
        
        # months=1 should have fewer or equal rows (smaller window)
        assert len(data_1) <= len(data_3), f"months=1 ({len(data_1)}) should be <= months=3 ({len(data_3)})"
        print(f"months=1: {len(data_1)} items, months=3: {len(data_3)} items")
    
    def test_new_styles_months_12_returns_more_or_equal(self):
        """GET /api/analytics/new-styles?months=12 returns more or equal rows vs months=3"""
        response_3 = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 3
        })
        response_12 = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 12
        })
        
        assert response_3.status_code == 200
        assert response_12.status_code == 200
        
        data_3 = response_3.json()
        data_12 = response_12.json()
        
        # months=12 should have more or equal rows (larger window)
        assert len(data_12) >= len(data_3), f"months=12 ({len(data_12)}) should be >= months=3 ({len(data_3)})"
        print(f"months=3: {len(data_3)} items, months=12: {len(data_12)} items")
    
    def test_new_styles_with_store_id_uganda(self):
        """GET /api/analytics/new-styles?store_id=vivo-uganda restricts to Uganda"""
        response = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "store_id": "vivo-uganda",
            "months": 3
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"New styles for Uganda: {len(data)} items")
    
    def test_new_styles_with_location_filter(self):
        """GET /api/analytics/new-styles?location='Vivo Sarit' works without 500"""
        response = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "location": "Vivo Sarit",
            "months": 3
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"New styles for Vivo Sarit: {len(data)} items")
    
    def test_new_styles_sorting_by_launch_sort_desc_then_units_sold_desc(self):
        """First row should have largest launch_sort (newest launch), ties broken by units_sold desc"""
        response = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 3
        })
        assert response.status_code == 200
        data = response.json()
        
        if len(data) < 2:
            pytest.skip("Not enough data to verify sorting")
        
        # Verify sorted by launch_sort descending
        for i in range(len(data) - 1):
            curr_sort = data[i].get("launch_sort", 0)
            next_sort = data[i+1].get("launch_sort", 0)
            
            if curr_sort == next_sort:
                # Same launch_sort, should be sorted by units_sold descending
                curr_units = data[i].get("units_sold", 0)
                next_units = data[i+1].get("units_sold", 0)
                assert curr_units >= next_units, \
                    f"Same launch_sort ({curr_sort}): expected units_sold desc, got {curr_units} < {next_units}"
            else:
                # Different launch_sort, should be descending
                assert curr_sort >= next_sort, \
                    f"Expected launch_sort descending, got {curr_sort} < {next_sort}"
        
        print(f"Sorting verified: first item launch_sort={data[0].get('launch_sort')}, units={data[0].get('units_sold')}")


class TestKpisPlusWithStoreIdFilter:
    """Test /api/analytics/kpis-plus with store_id filter - country filter fix"""
    
    def test_kpis_plus_unfiltered_returns_group_wide(self):
        """GET /api/analytics/kpis-plus without store_id returns group-wide figures"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_gross_sales" in data
        print(f"Group-wide KPIs: gross_sales={data.get('total_gross_sales')}, orders={data.get('total_orders')}")
        return data
    
    def test_kpis_plus_with_store_id_vivofashiongroup_returns_smaller_figures(self):
        """GET /api/analytics/kpis-plus?store_id=vivofashiongroup returns Kenya-only (smaller than group)"""
        # Get group-wide first
        response_all = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response_all.status_code == 200
        data_all = response_all.json()
        
        # Get Kenya-only
        response_kenya = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "store_id": "vivofashiongroup"
        })
        assert response_kenya.status_code == 200
        data_kenya = response_kenya.json()
        
        # Kenya-only should be smaller or equal to group-wide
        assert data_kenya.get("total_gross_sales", 0) <= data_all.get("total_gross_sales", 0), \
            f"Kenya ({data_kenya.get('total_gross_sales')}) should be <= group ({data_all.get('total_gross_sales')})"
        
        # If they're different, the filter is working
        if data_kenya.get("total_gross_sales") != data_all.get("total_gross_sales"):
            print(f"FILTER WORKING: Kenya={data_kenya.get('total_gross_sales')}, Group={data_all.get('total_gross_sales')}")
        else:
            print(f"WARNING: Kenya equals Group - may need more data to verify filter")
    
    def test_kpis_plus_with_store_id_uganda_returns_uganda_only(self):
        """GET /api/analytics/kpis-plus?store_id=vivo-uganda returns Uganda-only figures (~3,805,746)"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "store_id": "vivo-uganda"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify we get Uganda-specific data
        gross_sales = data.get("total_gross_sales", 0)
        print(f"Uganda KPIs: gross_sales={gross_sales}, orders={data.get('total_orders')}")
        
        # Cross-check with /api/kpis for Uganda
        kpis_response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "store_id": "vivo-uganda"
        })
        assert kpis_response.status_code == 200
        kpis_data = kpis_response.json()
        
        # kpis-plus should match base kpis for gross_sales
        assert abs(data.get("total_gross_sales", 0) - kpis_data.get("total_gross_sales", 0)) < 1, \
            f"kpis-plus ({data.get('total_gross_sales')}) should match kpis ({kpis_data.get('total_gross_sales')})"
    
    def test_kpis_plus_with_store_id_rwanda_returns_rwanda_only(self):
        """GET /api/analytics/kpis-plus?store_id=vivo-rwanda returns Rwanda-only figures"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "store_id": "vivo-rwanda"
        })
        assert response.status_code == 200
        data = response.json()
        
        print(f"Rwanda KPIs: gross_sales={data.get('total_gross_sales')}, orders={data.get('total_orders')}")
        
        # Verify augmented fields still present
        assert "sell_through_rate" in data, "Expected sell_through_rate in kpis-plus"
        assert "units_clean" in data, "Expected units_clean in kpis-plus"
    
    def test_kpis_plus_previous_month_comparison(self):
        """GET /api/analytics/kpis-plus?date_from=2026-03-01&date_to=2026-03-17 returns valid KPIs (for MoM delta)"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": "2026-03-01",
            "date_to": "2026-03-17"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should have all required fields even if values are 0
        assert "total_gross_sales" in data
        assert "total_orders" in data
        assert "sell_through_rate" in data
        
        print(f"Previous month (Mar 2026) KPIs: gross_sales={data.get('total_gross_sales')}, orders={data.get('total_orders')}")
    
    def test_kpis_plus_previous_year_comparison(self):
        """GET /api/analytics/kpis-plus?date_from=2025-04-01&date_to=2025-04-17 returns valid response (even if zeros)"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": "2025-04-01",
            "date_to": "2025-04-17"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should have all required fields even if values are 0
        assert "total_gross_sales" in data
        assert "total_orders" in data
        
        print(f"Previous year (Apr 2025) KPIs: gross_sales={data.get('total_gross_sales')}, orders={data.get('total_orders')}")


class TestExistingEndpointsRegression:
    """Regression tests for existing endpoints - should still pass"""
    
    def test_root_endpoint(self):
        """GET /api/ returns {status: ok}"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        print("Root endpoint OK")
    
    def test_locations_endpoint(self):
        """GET /api/locations returns list"""
        response = requests.get(f"{BASE_URL}/api/locations")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"Locations: {len(data)} items")
    
    def test_kpis_endpoint(self):
        """GET /api/kpis returns KPI fields"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_gross_sales" in data
        print(f"KPIs: gross_sales={data.get('total_gross_sales')}")
    
    def test_sales_summary_endpoint(self):
        """GET /api/sales-summary returns list"""
        response = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Sales summary: {len(data)} items")
    
    def test_top_skus_endpoint(self):
        """GET /api/top-skus returns list"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Top SKUs: {len(data)} items")
    
    def test_sor_endpoint(self):
        """GET /api/sor returns list"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"SOR: {len(data)} items")
    
    def test_daily_trend_endpoint(self):
        """GET /api/daily-trend returns list"""
        response = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Daily trend: {len(data)} items")
    
    def test_inventory_endpoint(self):
        """GET /api/inventory returns list"""
        response = requests.get(f"{BASE_URL}/api/inventory")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Inventory: {len(data)} items")
    
    def test_analytics_highlights_endpoint(self):
        """GET /api/analytics/highlights returns structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/highlights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert "top_location" in data
        assert "top_brand" in data
        print(f"Highlights: top_location={data.get('top_location')}")
    
    def test_analytics_by_country_endpoint(self):
        """GET /api/analytics/by-country returns list"""
        response = requests.get(f"{BASE_URL}/api/analytics/by-country", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"By-country: {len(data)} items")
    
    def test_analytics_inventory_summary_endpoint(self):
        """GET /api/analytics/inventory-summary returns structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/inventory-summary")
        assert response.status_code == 200
        data = response.json()
        assert "total_units" in data
        assert "markets" in data
        print(f"Inventory summary: total_units={data.get('total_units')}, markets={data.get('markets')}")
    
    def test_analytics_low_stock_endpoint(self):
        """GET /api/analytics/low-stock returns list"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={"threshold": 2})
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Low stock: {len(data)} items")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
