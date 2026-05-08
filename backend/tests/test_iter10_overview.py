"""Iter10 — Overview, Purchase Frequency, New Customers, Drop-off Forecast."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
MGR_TOKEN = "test_session_vivo_mgr_1778250692444"
ASSOC_TOKEN = "test_session_vivo_assoc_1778250692444"


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---- /api/insights/overview ----
class TestOverview:
    def test_manager_ok(self):
        r = requests.get(f"{BASE_URL}/api/insights/overview", headers=_hdr(MGR_TOKEN), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "generated_at" in d
        kpis = d["kpis"]
        for k in [
            "total_customers", "new_customers_30d", "new_customers_delta_pct",
            "active_customers_30d", "active_customers_delta_pct", "vip_customers",
            "at_risk_customers", "avg_basket_kes", "messages_sent_30d",
            "messages_delta_pct", "social_sentiment_net", "social_feedback_30d",
        ]:
            assert k in kpis, f"missing kpi {k}"
        assert isinstance(d["tier_distribution"], dict)
        assert isinstance(d["sentiment_distribution"], dict)
        assert isinstance(d["callouts"], list)
        for c in d["callouts"]:
            assert "tone" in c and "text" in c

    def test_associate_403(self):
        r = requests.get(f"{BASE_URL}/api/insights/overview", headers=_hdr(ASSOC_TOKEN), timeout=30)
        assert r.status_code == 403


# ---- /api/insights/purchase-frequency ----
class TestPurchaseFrequency:
    def test_manager_ok(self):
        r = requests.get(f"{BASE_URL}/api/insights/purchase-frequency", headers=_hdr(MGR_TOKEN), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_customers", "multi_order_customers", "one_time_customers",
                  "overall_avg_cadence_days", "median_cadence_days", "buckets"]:
            assert k in d
        assert isinstance(d["buckets"], list) and len(d["buckets"]) == 7
        keys = {b["bucket"] for b in d["buckets"]}
        assert keys == {"weekly", "monthly", "quarterly", "biannual", "yearly", "lapsed", "one_time"}
        for b in d["buckets"]:
            assert "label" in b and "count" in b and "pct_of_base" in b and "customers_ltv_kes" in b

    def test_associate_403(self):
        r = requests.get(f"{BASE_URL}/api/insights/purchase-frequency", headers=_hdr(ASSOC_TOKEN), timeout=30)
        assert r.status_code == 403


# ---- /api/insights/new-customers ----
class TestNewCustomers:
    @pytest.mark.parametrize("days", [30, 60, 90])
    def test_window_returns_correct_shape(self, days):
        r = requests.get(f"{BASE_URL}/api/insights/new-customers", params={"days": days},
                         headers=_hdr(MGR_TOKEN), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["window_days"] == days
        for k in ["count", "avg_first_basket_kes", "converted_second_order",
                  "single_order_still", "second_order_rate_pct",
                  "by_month", "by_city", "top_arrivals"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["by_month"], list)
        assert isinstance(d["by_city"], list)
        assert isinstance(d["top_arrivals"], list)
        for ta in d["top_arrivals"]:
            for k in ["customer_id", "customer_name", "city",
                      "first_purchase_date", "total_orders",
                      "total_sales", "rfm_tier"]:
                assert k in ta

    def test_window_counts_monotonic(self):
        c30 = requests.get(f"{BASE_URL}/api/insights/new-customers", params={"days": 30},
                           headers=_hdr(MGR_TOKEN), timeout=30).json()["count"]
        c90 = requests.get(f"{BASE_URL}/api/insights/new-customers", params={"days": 90},
                           headers=_hdr(MGR_TOKEN), timeout=30).json()["count"]
        assert c90 >= c30  # wider window cannot have fewer customers

    def test_associate_403(self):
        r = requests.get(f"{BASE_URL}/api/insights/new-customers", headers=_hdr(ASSOC_TOKEN), timeout=30)
        assert r.status_code == 403


# ---- /api/insights/dropoff-forecast ----
class TestDropoffForecast:
    def test_manager_ok(self):
        r = requests.get(f"{BASE_URL}/api/insights/dropoff-forecast", params={"days": 90},
                         headers=_hdr(MGR_TOKEN), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["window_days", "evaluated", "already_converted",
                  "projected_churn_next_30d", "bands", "at_risk_customers", "methodology"]:
            assert k in d, f"missing {k}"
        assert d["window_days"] == 90
        assert set(d["bands"].keys()) == {"high", "medium", "low"}
        # sorted desc by risk_score
        scores = [c["risk_score"] for c in d["at_risk_customers"]]
        assert scores == sorted(scores, reverse=True)
        for c in d["at_risk_customers"]:
            for k in ["customer_id", "risk_score", "risk_band", "reasons"]:
                assert k in c
            assert c["risk_band"] in {"high", "medium", "low"}

    def test_associate_403(self):
        r = requests.get(f"{BASE_URL}/api/insights/dropoff-forecast",
                         headers=_hdr(ASSOC_TOKEN), timeout=30)
        assert r.status_code == 403
