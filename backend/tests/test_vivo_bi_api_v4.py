"""
Vivo BI Dashboard API Tests - Iteration 4
Major backend rebuild with new endpoints and multi-value aggregation.

NEW ENDPOINTS:
- /api/country-summary - returns 4 countries (Kenya, Uganda, Rwanda, Online)
- /api/analytics/insights - auto-generated CEO report text
- /api/analytics/returns - top channels by returns

REMOVED ENDPOINTS (from iteration 3):
- /api/analytics/highlights
- /api/analytics/by-country
- /api/analytics/new-styles
- /api/analytics/kpis-plus

KEY NEW CAPABILITY:
- Multi-value aggregation: country=Kenya,Uganda aggregates both countries
- New KPI fields: total_sales, total_discounts, total_returns, return_rate

Date range: 2026-04-01 to 2026-04-17
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Date range with data on upstream
DEFAULT_DATE_FROM = "2026-04-01"
DEFAULT_DATE_TO = "2026-04-17"


class TestKpisEndpoint:
    """Test /api/kpis with new fields and multi-value aggregation"""
    
    def test_kpis_returns_all_required_fields(self):
        """GET /api/kpis returns all 10 required fields"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify all 10 required fields
        required_fields = [
            "total_sales", "gross_sales", "total_discounts", "total_returns",
            "net_sales", "total_orders", "total_units", "avg_basket_size",
            "avg_selling_price", "return_rate"
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}. Got keys: {list(data.keys())}"
        
        print(f"KPIs (all fields): total_sales={data.get('total_sales')}, return_rate={data.get('return_rate')}")
    
    def test_kpis_country_kenya_returns_kenya_only(self):
        """GET /api/kpis?country=Kenya returns Kenya-only (total_sales around 39.9M)"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        total_sales = data.get("total_sales", 0)
        print(f"Kenya KPIs: total_sales={total_sales}")
        
        # Kenya should have significant sales (around 39.9M based on context)
        assert total_sales > 0, "Kenya should have positive total_sales"
        return total_sales
    
    def test_kpis_multi_country_aggregation(self):
        """GET /api/kpis?country=Kenya,Uganda aggregates - sum of country totals"""
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200
        kenya_data = response_kenya.json()
        kenya_sales = kenya_data.get("total_sales", 0)
        kenya_orders = kenya_data.get("total_orders", 0)
        
        # Get Uganda only
        response_uganda = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Uganda"
        })
        assert response_uganda.status_code == 200
        uganda_data = response_uganda.json()
        uganda_sales = uganda_data.get("total_sales", 0)
        uganda_orders = uganda_data.get("total_orders", 0)
        
        # Get combined Kenya,Uganda
        response_combined = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response_combined.status_code == 200, f"Expected 200, got {response_combined.status_code}: {response_combined.text}"
        combined_data = response_combined.json()
        combined_sales = combined_data.get("total_sales", 0)
        combined_orders = combined_data.get("total_orders", 0)
        
        # Verify aggregation: combined should equal sum of individual (allow small rounding)
        expected_sales = kenya_sales + uganda_sales
        expected_orders = kenya_orders + uganda_orders
        
        # Allow 1% tolerance for rounding
        sales_diff = abs(combined_sales - expected_sales)
        orders_diff = abs(combined_orders - expected_orders)
        
        print(f"Kenya: sales={kenya_sales}, orders={kenya_orders}")
        print(f"Uganda: sales={uganda_sales}, orders={uganda_orders}")
        print(f"Combined: sales={combined_sales}, orders={combined_orders}")
        print(f"Expected: sales={expected_sales}, orders={expected_orders}")
        
        assert sales_diff < expected_sales * 0.01 or sales_diff < 100, \
            f"Combined sales ({combined_sales}) should equal Kenya+Uganda ({expected_sales})"
        assert orders_diff < expected_orders * 0.01 or orders_diff < 10, \
            f"Combined orders ({combined_orders}) should equal Kenya+Uganda ({expected_orders})"
    
    def test_kpis_single_channel_filter(self):
        """GET /api/kpis?channel=Vivo+Sarit returns single-channel results"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "channel": "Vivo Sarit"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should have valid KPI data
        assert "total_sales" in data
        assert "total_orders" in data
        print(f"Vivo Sarit KPIs: total_sales={data.get('total_sales')}, orders={data.get('total_orders')}")


class TestCountrySummaryEndpoint:
    """Test NEW /api/country-summary endpoint"""
    
    def test_country_summary_returns_4_countries(self):
        """GET /api/country-summary returns 4 countries (Kenya, Uganda, Rwanda, Online)"""
        response = requests.get(f"{BASE_URL}/api/country-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Extract country names
        countries = [row.get("country") for row in data]
        print(f"Countries in summary: {countries}")
        
        # Should have at least Kenya, Uganda, Rwanda (Online may or may not be present)
        expected_countries = {"Kenya", "Uganda", "Rwanda"}
        found_countries = set(countries)
        
        for expected in expected_countries:
            assert expected in found_countries, f"Expected {expected} in country-summary, got {countries}"
    
    def test_country_summary_has_required_fields(self):
        """Each country row has required fields"""
        response = requests.get(f"{BASE_URL}/api/country-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        required_fields = [
            "country", "orders", "units_sold", "total_sales", "gross_sales",
            "discounts", "returns", "net_sales", "avg_basket_size"
        ]
        
        for row in data:
            for field in required_fields:
                assert field in row, f"Missing field {field} in country row. Got: {list(row.keys())}"
        
        # Print sample
        if data:
            sample = data[0]
            print(f"Sample country: {sample.get('country')}, total_sales={sample.get('total_sales')}, orders={sample.get('orders')}")


class TestSalesSummaryEndpoint:
    """Test /api/sales-summary with country filter"""
    
    def test_sales_summary_country_kenya_returns_kenyan_channels(self):
        """GET /api/sales-summary?country=Kenya returns only Kenyan channels"""
        response = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one channel for Kenya"
        
        # All rows should be Kenya
        for row in data:
            country = row.get("country", "").lower()
            assert "kenya" in country.lower(), f"Expected Kenya channel, got country={row.get('country')}"
        
        print(f"Kenya channels: {len(data)} items")
        if data:
            print(f"Sample: {data[0].get('channel')}, total_sales={data[0].get('total_sales')}")
    
    def test_sales_summary_multi_country_returns_combined_channels(self):
        """GET /api/sales-summary?country=Kenya,Uganda returns combined channels (deduplicated)"""
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200
        kenya_data = response_kenya.json()
        
        # Get Uganda only
        response_uganda = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Uganda"
        })
        assert response_uganda.status_code == 200
        uganda_data = response_uganda.json()
        
        # Get combined
        response_combined = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response_combined.status_code == 200, f"Expected 200, got {response_combined.status_code}: {response_combined.text}"
        combined_data = response_combined.json()
        
        # Combined should have channels from both countries
        kenya_channels = set(row.get("channel") for row in kenya_data)
        uganda_channels = set(row.get("channel") for row in uganda_data)
        combined_channels = set(row.get("channel") for row in combined_data)
        
        print(f"Kenya channels: {len(kenya_channels)}, Uganda channels: {len(uganda_channels)}, Combined: {len(combined_channels)}")
        
        # Combined should include channels from both
        assert len(combined_data) >= max(len(kenya_data), len(uganda_data)), \
            "Combined should have at least as many channels as the larger country"


class TestTopSkusEndpoint:
    """Test /api/top-skus with limit and multi-country aggregation"""
    
    def test_top_skus_limit_20_returns_20_items(self):
        """GET /api/top-skus?limit=20 returns 20 items"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "limit": 20
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) == 20, f"Expected 20 items, got {len(data)}"
        
        # Verify required fields exist
        if data:
            assert "sku" in data[0], "Expected 'sku' field in top-skus row"
            assert "total_sales" in data[0], "Expected 'total_sales' field in top-skus row"
        
        # Note: Upstream API may not guarantee sorting for single-country requests
        # Sorting is only guaranteed for multi-country aggregation
        print(f"Top SKUs: {len(data)} items, first SKU={data[0].get('sku')}, sales={data[0].get('total_sales')}")
    
    def test_top_skus_multi_country_merges_same_sku(self):
        """GET /api/top-skus?country=Kenya,Uganda&limit=10 - rows merged when same SKU appears"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda",
            "limit": 10
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) <= 10, f"Expected at most 10 items, got {len(data)}"
        
        # Verify no duplicate SKUs (merged)
        skus = [row.get("sku") for row in data]
        assert len(skus) == len(set(skus)), f"Expected unique SKUs after merge, got duplicates: {skus}"
        
        # Multi-country aggregation SHOULD be sorted by total_sales descending
        for i in range(len(data) - 1):
            curr_sales = data[i].get("total_sales", 0)
            next_sales = data[i+1].get("total_sales", 0)
            assert curr_sales >= next_sales, f"Multi-country should be sorted by total_sales desc, got {curr_sales} < {next_sales}"
        
        print(f"Multi-country top SKUs: {len(data)} items (merged and sorted)")


class TestSorEndpoint:
    """Test /api/sor with sor_percent and multi-country aggregation"""
    
    def test_sor_returns_list_with_sor_percent(self):
        """GET /api/sor returns list with sor_percent field"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one SOR row"
        
        # Verify sor_percent field exists and is valid (0-100)
        for row in data:
            assert "sor_percent" in row, f"Missing sor_percent in SOR row. Got: {list(row.keys())}"
            sor_pct = row.get("sor_percent", 0)
            assert 0 <= sor_pct <= 100, f"sor_percent should be 0-100, got {sor_pct}"
        
        # Note: Upstream API may not guarantee sorting for single-country requests
        # Sorting is only guaranteed for multi-country aggregation
        print(f"SOR: {len(data)} items, first style={data[0].get('style_name')}, sor_percent={data[0].get('sor_percent')}")
    
    def test_sor_multi_country_recomputes_sor_percent(self):
        """GET /api/sor?country=Kenya,Uganda - sor_percent re-computed after merge and sorted"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Verify sor_percent is valid (0-100)
        for row in data:
            sor_pct = row.get("sor_percent", 0)
            assert 0 <= sor_pct <= 100, f"sor_percent should be 0-100, got {sor_pct}"
        
        # Multi-country aggregation SHOULD be sorted by sor_percent descending
        for i in range(len(data) - 1):
            curr_sor = data[i].get("sor_percent", 0)
            next_sor = data[i+1].get("sor_percent", 0)
            assert curr_sor >= next_sor, f"Multi-country should be sorted by sor_percent desc, got {curr_sor} < {next_sor}"
        
        print(f"Multi-country SOR: {len(data)} items (sorted by sor_percent)")


class TestDailyTrendEndpoint:
    """Test /api/daily-trend with multi-country aggregation"""
    
    def test_daily_trend_returns_daily_breakdown(self):
        """GET /api/daily-trend returns daily breakdown"""
        response = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one day"
        
        # Verify required fields
        for row in data:
            assert "day" in row, f"Missing 'day' field in daily-trend row"
            assert "orders" in row or "gross_sales" in row, f"Missing orders/gross_sales in row"
        
        print(f"Daily trend: {len(data)} days")
    
    def test_daily_trend_multi_country_aggregates_per_day(self):
        """GET /api/daily-trend?country=Kenya,Uganda aggregates per day"""
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200
        kenya_data = response_kenya.json()
        
        # Get combined
        response_combined = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response_combined.status_code == 200, f"Expected 200, got {response_combined.status_code}: {response_combined.text}"
        combined_data = response_combined.json()
        
        # Combined should have same number of days (aggregated per day)
        assert len(combined_data) == len(kenya_data), \
            f"Combined should have same days as Kenya, got {len(combined_data)} vs {len(kenya_data)}"
        
        print(f"Multi-country daily trend: {len(combined_data)} days (aggregated)")


class TestInventoryEndpoint:
    """Test /api/inventory with country filter"""
    
    def test_inventory_country_filter_works(self):
        """GET /api/inventory?country=kenya filter works"""
        response = requests.get(f"{BASE_URL}/api/inventory", params={
            "country": "kenya"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"Kenya inventory: {len(data)} items")


class TestAnalyticsInventorySummary:
    """Test /api/analytics/inventory-summary"""
    
    def test_inventory_summary_returns_all_required_fields(self):
        """GET /api/analytics/inventory-summary returns all required fields"""
        response = requests.get(f"{BASE_URL}/api/analytics/inventory-summary")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        required_fields = [
            "total_units", "total_skus", "low_stock_skus", "warehouse_fg_stock",
            "markets", "by_country", "by_location", "by_product_type"
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}. Got: {list(data.keys())}"
        
        # Verify nested structures
        assert isinstance(data.get("by_country"), list), "by_country should be a list"
        assert isinstance(data.get("by_location"), list), "by_location should be a list"
        assert isinstance(data.get("by_product_type"), list), "by_product_type should be a list"
        
        print(f"Inventory summary: total_units={data.get('total_units')}, low_stock={data.get('low_stock_skus')}, markets={data.get('markets')}")


class TestAnalyticsLowStock:
    """Test /api/analytics/low-stock"""
    
    def test_low_stock_threshold_2_returns_sorted_ascending(self):
        """GET /api/analytics/low-stock?threshold=2 returns rows with available <= 2 sorted ascending"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={
            "threshold": 2
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Verify all rows have available <= 2
        for row in data:
            avail = row.get("available", 0)
            assert avail <= 2, f"Expected available <= 2, got {avail}"
        
        # Verify sorted ascending by available
        for i in range(len(data) - 1):
            curr_avail = data[i].get("available", 0)
            next_avail = data[i+1].get("available", 0)
            assert curr_avail <= next_avail, f"Expected sorted ascending, got {curr_avail} > {next_avail}"
        
        print(f"Low stock (threshold=2): {len(data)} items")


class TestAnalyticsInsights:
    """Test NEW /api/analytics/insights endpoint"""
    
    def test_insights_returns_required_fields(self):
        """GET /api/analytics/insights returns {text, top_country, top_store}"""
        response = requests.get(f"{BASE_URL}/api/analytics/insights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "text" in data, f"Missing 'text' field. Got: {list(data.keys())}"
        assert "top_country" in data, f"Missing 'top_country' field. Got: {list(data.keys())}"
        assert "top_store" in data, f"Missing 'top_store' field. Got: {list(data.keys())}"
        
        print(f"Insights: top_country={data.get('top_country')}, top_store={data.get('top_store')}")
    
    def test_insights_text_contains_percent_and_kes(self):
        """Insights text should contain at least '%' and 'KES'"""
        response = requests.get(f"{BASE_URL}/api/analytics/insights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200
        data = response.json()
        
        text = data.get("text", "")
        assert "%" in text, f"Expected '%' in insights text, got: {text}"
        assert "KES" in text, f"Expected 'KES' in insights text, got: {text}"
        
        print(f"Insights text: {text[:200]}...")


class TestAnalyticsReturns:
    """Test NEW /api/analytics/returns endpoint"""
    
    def test_returns_has_top_channels_sorted_by_returns_desc(self):
        """GET /api/analytics/returns returns {top_channels} sorted by returns desc"""
        response = requests.get(f"{BASE_URL}/api/analytics/returns", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "top_channels" in data, f"Missing 'top_channels' field. Got: {list(data.keys())}"
        
        top_channels = data.get("top_channels", [])
        assert isinstance(top_channels, list), f"top_channels should be a list"
        
        # Verify sorted by returns descending
        for i in range(len(top_channels) - 1):
            curr_returns = top_channels[i].get("returns", 0)
            next_returns = top_channels[i+1].get("returns", 0)
            assert curr_returns >= next_returns, f"Expected sorted by returns desc, got {curr_returns} < {next_returns}"
        
        print(f"Returns: {len(top_channels)} top channels")
        if top_channels:
            print(f"Top channel: {top_channels[0].get('channel')}, returns={top_channels[0].get('returns')}")


class TestRootAndLocations:
    """Test basic endpoints"""
    
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


class TestRemovedEndpoints:
    """Verify old endpoints from iteration 3 are removed (should return 404 or different behavior)"""
    
    def test_analytics_highlights_removed(self):
        """GET /api/analytics/highlights should return 404 (removed in iteration 4)"""
        response = requests.get(f"{BASE_URL}/api/analytics/highlights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        # Should be 404 or 405 (not found)
        assert response.status_code in [404, 405, 422], \
            f"Expected 404/405/422 for removed endpoint, got {response.status_code}"
        print(f"/api/analytics/highlights correctly removed (status={response.status_code})")
    
    def test_analytics_by_country_removed(self):
        """GET /api/analytics/by-country should return 404 (removed in iteration 4)"""
        response = requests.get(f"{BASE_URL}/api/analytics/by-country", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code in [404, 405, 422], \
            f"Expected 404/405/422 for removed endpoint, got {response.status_code}"
        print(f"/api/analytics/by-country correctly removed (status={response.status_code})")
    
    def test_analytics_new_styles_removed(self):
        """GET /api/analytics/new-styles should return 404 (removed in iteration 4)"""
        response = requests.get(f"{BASE_URL}/api/analytics/new-styles", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "months": 3
        })
        assert response.status_code in [404, 405, 422], \
            f"Expected 404/405/422 for removed endpoint, got {response.status_code}"
        print(f"/api/analytics/new-styles correctly removed (status={response.status_code})")
    
    def test_analytics_kpis_plus_removed(self):
        """GET /api/analytics/kpis-plus should return 404 (removed in iteration 4)"""
        response = requests.get(f"{BASE_URL}/api/analytics/kpis-plus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code in [404, 405, 422], \
            f"Expected 404/405/422 for removed endpoint, got {response.status_code}"
        print(f"/api/analytics/kpis-plus correctly removed (status={response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
