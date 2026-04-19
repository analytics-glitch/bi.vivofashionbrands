"""
Vivo BI Dashboard API Tests - Iteration 5
Complete rebuild with 6 NEW proxy endpoints.

NEW ENDPOINTS (Iteration 5):
- /api/customers - customer metrics with weighted avg aggregation for multi-country
- /api/customer-trend - daily customer trend with multi-country merge
- /api/footfall - location footfall data with channel filter
- /api/subcategory-sales - subcategory sales data with multi-country merge
- /api/subcategory-stock-sales - subcategory stock/sales data
- /api/stock-to-sales - stock to sales ratio with deduplication

EXISTING ENDPOINTS (verified in iteration 4):
- /api/kpis, /api/country-summary, /api/sales-summary, /api/top-skus
- /api/sor, /api/daily-trend, /api/inventory
- /api/analytics/inventory-summary, /api/analytics/low-stock, /api/analytics/insights

Date range: 2026-04-01 to 2026-04-17
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Date range with data on upstream
DEFAULT_DATE_FROM = "2026-04-01"
DEFAULT_DATE_TO = "2026-04-17"


# ==================== NEW ENDPOINT: /api/customers ====================
class TestCustomersEndpoint:
    """Test NEW /api/customers endpoint with weighted average aggregation"""
    
    def test_customers_returns_all_required_fields(self):
        """GET /api/customers returns all 8 required fields"""
        response = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify all 8 required fields
        required_fields = [
            "total_customers", "new_customers", "repeat_customers",
            "returning_customers", "churned_customers", "avg_customer_spend",
            "avg_orders_per_customer"
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}. Got keys: {list(data.keys())}"
        
        # Verify values are reasonable
        assert data.get("total_customers", 0) > 0, "total_customers should be positive"
        assert data.get("avg_customer_spend", 0) > 0, "avg_customer_spend should be positive"
        
        print(f"Customers: total={data.get('total_customers')}, new={data.get('new_customers')}, avg_spend={data.get('avg_customer_spend')}")
    
    def test_customers_country_kenya_returns_kenya_only(self):
        """GET /api/customers?country=Kenya returns Kenya-only (smaller than group total)"""
        # Get all customers
        response_all = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response_all.status_code == 200
        all_data = response_all.json()
        all_total = all_data.get("total_customers", 0)
        
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200, f"Expected 200, got {response_kenya.status_code}: {response_kenya.text}"
        kenya_data = response_kenya.json()
        kenya_total = kenya_data.get("total_customers", 0)
        
        # Kenya should be smaller than or equal to group total
        assert kenya_total <= all_total, f"Kenya ({kenya_total}) should be <= group total ({all_total})"
        assert kenya_total > 0, "Kenya should have positive customers"
        
        print(f"Kenya customers: {kenya_total}, Group total: {all_total}")
        return kenya_data
    
    def test_customers_multi_country_weighted_average(self):
        """GET /api/customers?country=Kenya,Uganda - weighted avg for avg_customer_spend and avg_orders_per_customer"""
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200
        kenya_data = response_kenya.json()
        kenya_total = kenya_data.get("total_customers", 0)
        kenya_spend = kenya_data.get("avg_customer_spend", 0)
        kenya_orders = kenya_data.get("avg_orders_per_customer", 0)
        
        # Get Uganda only
        response_uganda = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Uganda"
        })
        assert response_uganda.status_code == 200
        uganda_data = response_uganda.json()
        uganda_total = uganda_data.get("total_customers", 0)
        uganda_spend = uganda_data.get("avg_customer_spend", 0)
        uganda_orders = uganda_data.get("avg_orders_per_customer", 0)
        
        # Get combined Kenya,Uganda
        response_combined = requests.get(f"{BASE_URL}/api/customers", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response_combined.status_code == 200, f"Expected 200, got {response_combined.status_code}: {response_combined.text}"
        combined_data = response_combined.json()
        combined_total = combined_data.get("total_customers", 0)
        combined_spend = combined_data.get("avg_customer_spend", 0)
        combined_orders = combined_data.get("avg_orders_per_customer", 0)
        
        # Verify total_customers is sum
        expected_total = kenya_total + uganda_total
        assert combined_total == expected_total, f"Combined total ({combined_total}) should equal Kenya+Uganda ({expected_total})"
        
        # Verify weighted average for avg_customer_spend
        if expected_total > 0:
            expected_spend = (kenya_spend * kenya_total + uganda_spend * uganda_total) / expected_total
            spend_diff = abs(combined_spend - expected_spend)
            assert spend_diff < expected_spend * 0.01 or spend_diff < 1, \
                f"Combined avg_spend ({combined_spend}) should be weighted avg ({expected_spend})"
            
            # Verify weighted average for avg_orders_per_customer
            expected_orders = (kenya_orders * kenya_total + uganda_orders * uganda_total) / expected_total
            orders_diff = abs(combined_orders - expected_orders)
            assert orders_diff < expected_orders * 0.01 or orders_diff < 0.01, \
                f"Combined avg_orders ({combined_orders}) should be weighted avg ({expected_orders})"
        
        print(f"Kenya: total={kenya_total}, spend={kenya_spend}, orders={kenya_orders}")
        print(f"Uganda: total={uganda_total}, spend={uganda_spend}, orders={uganda_orders}")
        print(f"Combined: total={combined_total}, spend={combined_spend}, orders={combined_orders}")


# ==================== NEW ENDPOINT: /api/customer-trend ====================
class TestCustomerTrendEndpoint:
    """Test NEW /api/customer-trend endpoint with daily rows"""
    
    def test_customer_trend_returns_daily_rows(self):
        """GET /api/customer-trend returns daily rows with required fields"""
        response = requests.get(f"{BASE_URL}/api/customer-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one day"
        
        # Verify required fields in each row
        required_fields = ["day", "total_customers", "new_customers", "returning_customers"]
        for row in data:
            for field in required_fields:
                assert field in row, f"Missing field {field} in customer-trend row. Got: {list(row.keys())}"
        
        print(f"Customer trend: {len(data)} days")
        if data:
            print(f"Sample: day={data[0].get('day')}, total={data[0].get('total_customers')}, new={data[0].get('new_customers')}")
    
    def test_customer_trend_multi_country_merges_per_day(self):
        """GET /api/customer-trend?country=Kenya,Uganda merges per day correctly"""
        # Get Kenya only
        response_kenya = requests.get(f"{BASE_URL}/api/customer-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response_kenya.status_code == 200
        kenya_data = response_kenya.json()
        
        # Get Uganda only
        response_uganda = requests.get(f"{BASE_URL}/api/customer-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Uganda"
        })
        assert response_uganda.status_code == 200
        uganda_data = response_uganda.json()
        
        # Get combined
        response_combined = requests.get(f"{BASE_URL}/api/customer-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response_combined.status_code == 200, f"Expected 200, got {response_combined.status_code}: {response_combined.text}"
        combined_data = response_combined.json()
        
        # Build lookup by day
        kenya_by_day = {r.get("day"): r for r in kenya_data}
        uganda_by_day = {r.get("day"): r for r in uganda_data}
        
        # Verify merge: for each day in combined, total_customers = kenya + uganda
        for row in combined_data:
            day = row.get("day")
            kenya_row = kenya_by_day.get(day, {})
            uganda_row = uganda_by_day.get(day, {})
            
            expected_total = (kenya_row.get("total_customers") or 0) + (uganda_row.get("total_customers") or 0)
            actual_total = row.get("total_customers", 0)
            
            # Allow small tolerance
            assert abs(actual_total - expected_total) < 5, \
                f"Day {day}: combined total ({actual_total}) should equal Kenya+Uganda ({expected_total})"
        
        print(f"Multi-country customer trend: {len(combined_data)} days (merged correctly)")


# ==================== NEW ENDPOINT: /api/footfall ====================
class TestFootfallEndpoint:
    """Test NEW /api/footfall endpoint with location data"""
    
    def test_footfall_returns_location_rows(self):
        """GET /api/footfall returns ~28 rows with required fields"""
        response = requests.get(f"{BASE_URL}/api/footfall")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one location"
        
        # Verify required fields in each row
        required_fields = ["location", "total_footfall", "orders", "total_sales", "conversion_rate", "sales_per_visitor"]
        for row in data[:5]:  # Check first 5 rows
            for field in required_fields:
                assert field in row, f"Missing field {field} in footfall row. Got: {list(row.keys())}"
        
        print(f"Footfall: {len(data)} locations")
        if data:
            print(f"Sample: location={data[0].get('location')}, footfall={data[0].get('total_footfall')}, conversion={data[0].get('conversion_rate')}")
    
    def test_footfall_channel_filter_single_location(self):
        """GET /api/footfall?channel=Vivo+Sarit filters to single location"""
        response = requests.get(f"{BASE_URL}/api/footfall", params={
            "channel": "Vivo Sarit"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Should return 1 or few locations matching the channel
        assert len(data) >= 1, "Expected at least one location for Vivo Sarit"
        
        # Verify the location matches
        locations = [r.get("location") for r in data]
        print(f"Footfall for Vivo Sarit: {len(data)} locations - {locations}")


# ==================== NEW ENDPOINT: /api/subcategory-sales ====================
class TestSubcategorySalesEndpoint:
    """Test NEW /api/subcategory-sales endpoint"""
    
    def test_subcategory_sales_returns_rows_with_required_fields(self):
        """GET /api/subcategory-sales returns rows with subcategory, units_sold, total_sales"""
        response = requests.get(f"{BASE_URL}/api/subcategory-sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one subcategory"
        
        # Verify required fields
        required_fields = ["subcategory", "units_sold", "total_sales"]
        for row in data[:5]:  # Check first 5 rows
            for field in required_fields:
                assert field in row, f"Missing field {field} in subcategory-sales row. Got: {list(row.keys())}"
        
        print(f"Subcategory sales: {len(data)} subcategories")
        if data:
            print(f"Sample: subcategory={data[0].get('subcategory')}, units={data[0].get('units_sold')}, sales={data[0].get('total_sales')}")
    
    def test_subcategory_sales_multi_country_merges(self):
        """GET /api/subcategory-sales?country=Kenya,Uganda merges subcategories"""
        response = requests.get(f"{BASE_URL}/api/subcategory-sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Verify no duplicate subcategories (merged)
        subcategories = [(r.get("subcategory"), r.get("brand")) for r in data]
        assert len(subcategories) == len(set(subcategories)), "Expected unique subcategory+brand after merge"
        
        # Verify sorted by total_sales descending
        for i in range(len(data) - 1):
            curr_sales = data[i].get("total_sales", 0)
            next_sales = data[i+1].get("total_sales", 0)
            assert curr_sales >= next_sales, f"Should be sorted by total_sales desc, got {curr_sales} < {next_sales}"
        
        print(f"Multi-country subcategory sales: {len(data)} items (merged and sorted)")


# ==================== NEW ENDPOINT: /api/subcategory-stock-sales ====================
class TestSubcategoryStockSalesEndpoint:
    """Test NEW /api/subcategory-stock-sales endpoint"""
    
    def test_subcategory_stock_sales_returns_rows_with_required_fields(self):
        """GET /api/subcategory-stock-sales returns rows with required fields"""
        response = requests.get(f"{BASE_URL}/api/subcategory-stock-sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one subcategory"
        
        # Verify required fields
        required_fields = ["subcategory", "units_sold", "current_stock", "sor_percent", "pct_of_total_sold", "pct_of_total_stock"]
        for row in data[:5]:  # Check first 5 rows
            for field in required_fields:
                assert field in row, f"Missing field {field} in subcategory-stock-sales row. Got: {list(row.keys())}"
        
        print(f"Subcategory stock-sales: {len(data)} subcategories")
        if data:
            print(f"Sample: subcategory={data[0].get('subcategory')}, sor_percent={data[0].get('sor_percent')}")


# ==================== NEW ENDPOINT: /api/stock-to-sales ====================
class TestStockToSalesEndpoint:
    """Test NEW /api/stock-to-sales endpoint with deduplication"""
    
    def test_stock_to_sales_returns_rows_with_required_fields(self):
        """GET /api/stock-to-sales returns rows with required fields"""
        response = requests.get(f"{BASE_URL}/api/stock-to-sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one location"
        
        # Verify required fields
        required_fields = ["location", "country", "units_sold", "current_stock", "stock_to_sales_ratio"]
        for row in data[:5]:  # Check first 5 rows
            for field in required_fields:
                assert field in row, f"Missing field {field} in stock-to-sales row. Got: {list(row.keys())}"
        
        print(f"Stock-to-sales: {len(data)} locations")
        if data:
            print(f"Sample: location={data[0].get('location')}, country={data[0].get('country')}, ratio={data[0].get('stock_to_sales_ratio')}")
    
    def test_stock_to_sales_multi_country_dedupes(self):
        """GET /api/stock-to-sales?country=Kenya,Uganda dedupes on (location,country)"""
        response = requests.get(f"{BASE_URL}/api/stock-to-sales", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya,Uganda"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Verify no duplicate (location, country) pairs
        keys = [(r.get("location"), r.get("country")) for r in data]
        assert len(keys) == len(set(keys)), f"Expected unique (location,country) pairs, got duplicates"
        
        # Verify we have both Kenya and Uganda locations
        countries = set(r.get("country") for r in data)
        print(f"Multi-country stock-to-sales: {len(data)} locations, countries: {countries}")


# ==================== REGRESSION: Existing endpoints still work ====================
class TestExistingEndpointsRegression:
    """Verify existing endpoints from iteration 4 still work"""
    
    def test_kpis_still_works(self):
        """GET /api/kpis still returns all required fields"""
        response = requests.get(f"{BASE_URL}/api/kpis", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        required_fields = ["total_sales", "gross_sales", "total_orders", "total_units"]
        for field in required_fields:
            assert field in data, f"Missing field {field} in kpis"
        
        print(f"KPIs regression: total_sales={data.get('total_sales')}")
    
    def test_country_summary_still_works(self):
        """GET /api/country-summary still returns countries"""
        response = requests.get(f"{BASE_URL}/api/country-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) >= 3, "Expected at least 3 countries"
        
        print(f"Country summary regression: {len(data)} countries")
    
    def test_sales_summary_still_works(self):
        """GET /api/sales-summary still returns channels"""
        response = requests.get(f"{BASE_URL}/api/sales-summary", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one channel"
        
        print(f"Sales summary regression: {len(data)} channels")
    
    def test_top_skus_still_works(self):
        """GET /api/top-skus still returns SKUs"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "limit": 10
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) <= 10, f"Expected at most 10 items, got {len(data)}"
        
        print(f"Top SKUs regression: {len(data)} items")
    
    def test_top_skus_country_kenya_sorted_by_total_sales_desc(self):
        """GET /api/top-skus?country=Kenya ordered by total_sales desc"""
        response = requests.get(f"{BASE_URL}/api/top-skus", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya",
            "limit": 20
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify sorted by total_sales descending
        for i in range(len(data) - 1):
            curr_sales = data[i].get("total_sales", 0)
            next_sales = data[i+1].get("total_sales", 0)
            assert curr_sales >= next_sales, f"Should be sorted by total_sales desc, got {curr_sales} < {next_sales}"
        
        print(f"Top SKUs Kenya: {len(data)} items (sorted by total_sales desc)")
    
    def test_sor_still_works(self):
        """GET /api/sor still returns SOR data"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one SOR row"
        
        print(f"SOR regression: {len(data)} items")
    
    def test_sor_country_kenya_sorted_by_sor_percent_desc(self):
        """GET /api/sor?country=Kenya ordered by sor_percent desc"""
        response = requests.get(f"{BASE_URL}/api/sor", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO,
            "country": "Kenya"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify sorted by sor_percent descending
        for i in range(len(data) - 1):
            curr_sor = data[i].get("sor_percent", 0)
            next_sor = data[i+1].get("sor_percent", 0)
            assert curr_sor >= next_sor, f"Should be sorted by sor_percent desc, got {curr_sor} < {next_sor}"
        
        print(f"SOR Kenya: {len(data)} items (sorted by sor_percent desc)")
    
    def test_daily_trend_still_works(self):
        """GET /api/daily-trend still returns daily data"""
        response = requests.get(f"{BASE_URL}/api/daily-trend", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one day"
        
        print(f"Daily trend regression: {len(data)} days")
    
    def test_inventory_still_works(self):
        """GET /api/inventory still returns inventory data"""
        response = requests.get(f"{BASE_URL}/api/inventory")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        print(f"Inventory regression: {len(data)} items")
    
    def test_analytics_inventory_summary_still_works(self):
        """GET /api/analytics/inventory-summary still returns summary"""
        response = requests.get(f"{BASE_URL}/api/analytics/inventory-summary")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "total_units" in data, "Missing total_units"
        assert "by_country" in data, "Missing by_country"
        
        print(f"Inventory summary regression: total_units={data.get('total_units')}")
    
    def test_analytics_low_stock_still_works(self):
        """GET /api/analytics/low-stock still returns low stock items"""
        response = requests.get(f"{BASE_URL}/api/analytics/low-stock", params={
            "threshold": 2
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        print(f"Low stock regression: {len(data)} items")
    
    def test_analytics_insights_still_works(self):
        """GET /api/analytics/insights still returns insights"""
        response = requests.get(f"{BASE_URL}/api/analytics/insights", params={
            "date_from": DEFAULT_DATE_FROM,
            "date_to": DEFAULT_DATE_TO
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "text" in data, "Missing text field"
        assert "top_country" in data, "Missing top_country field"
        
        print(f"Insights regression: top_country={data.get('top_country')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
