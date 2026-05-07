"""Iteration 49 — KPI Trend bucketed endpoint tests.

Targets the new /api/analytics/kpi-trend endpoint that fixes the
flat-zero Returns/Discount/ABV bug and adds day/week/month/quarter
drill up/down. All tests use the admin token.
"""
import os
import math
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get(path, headers, params=None, timeout=60):
    return requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=timeout)


# ─────────────────── DAY bucket ───────────────────
class TestKpiTrendDay:
    def test_daily_three_day_kenya_returns_three_rows(self, headers):
        r = _get("/api/analytics/kpi-trend", headers,
                 params={"date_from": "2026-01-15", "date_to": "2026-01-17",
                         "country": "Kenya", "bucket": "day"})
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) == 3, f"expected 3 daily rows, got {len(rows)}: {rows}"
        for row in rows:
            for k in ("label", "date", "bucket_start", "bucket_end",
                      "total_sales", "net_sales", "units_sold", "orders",
                      "discount", "returns", "avg_basket_size"):
                assert k in row, f"missing key {k} in {row}"

    def test_daily_non_zero_returns_discount_abv(self, headers):
        """Regression: Returns / Discount / ABV must not be flat-zero."""
        r = _get("/api/analytics/kpi-trend", headers,
                 params={"date_from": "2026-01-15", "date_to": "2026-01-17",
                         "country": "Kenya", "bucket": "day"})
        assert r.status_code == 200
        rows = r.json()
        # at least ONE row should have non-zero values for these fields
        any_returns = any((row.get("returns") or 0) != 0 for row in rows)
        any_discount = any((row.get("discount") or 0) != 0 for row in rows)
        any_abv = any((row.get("avg_basket_size") or 0) != 0 for row in rows)
        any_units = any((row.get("units_sold") or 0) != 0 for row in rows)
        any_orders = any((row.get("orders") or 0) != 0 for row in rows)
        assert any_returns, f"all rows have returns==0 — regression: {rows}"
        assert any_discount, f"all rows have discount==0 — regression: {rows}"
        assert any_abv, f"all rows have avg_basket_size==0 — regression: {rows}"
        assert any_units, f"all rows have units_sold==0: {rows}"
        assert any_orders, f"all rows have orders==0: {rows}"

    def test_daily_one_month_count_and_sum_matches_kpis(self, headers):
        df, dt = "2026-01-01", "2026-01-31"
        rt = _get("/api/analytics/kpi-trend", headers,
                  params={"date_from": df, "date_to": dt,
                          "country": "Kenya", "bucket": "day"}, timeout=120)
        assert rt.status_code == 200, rt.text[:300]
        rows = rt.json()
        assert 28 <= len(rows) <= 32, f"~30 daily rows expected, got {len(rows)}"
        rsum = sum((row.get("net_sales") or 0) for row in rows)
        rk = _get("/api/kpis", headers,
                  params={"date_from": df, "date_to": dt, "country": "Kenya"},
                  timeout=120)
        assert rk.status_code == 200
        kpi_net = rk.json().get("net_sales") or 0
        if kpi_net == 0 and rsum == 0:
            pytest.skip("no sales data in window — cannot compare")
        # tolerance 5% — bucketed sums sometimes drift due to per-day
        # rounding / partial-day aggregation upstream
        rel = abs(rsum - kpi_net) / max(1.0, abs(kpi_net))
        assert rel <= 0.05, f"daily-sum {rsum} vs /kpis {kpi_net} drift={rel:.3%}"


# ─────────────────── WEEK bucket ───────────────────
class TestKpiTrendWeek:
    def test_week_labels_and_intersection(self, headers):
        r = _get("/api/analytics/kpi-trend", headers,
                 params={"date_from": "2026-01-05", "date_to": "2026-01-25",
                         "country": "Kenya", "bucket": "week"})
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert len(rows) >= 3, f"expected ≥3 weekly rows, got {len(rows)}"
        for row in rows:
            assert row["label"].startswith("Wk "), f"bad week label: {row['label']}"
            assert row["bucket_start"] >= "2026-01-05"
            assert row["bucket_end"] <= "2026-01-25"


# ─────────────────── MONTH bucket ───────────────────
class TestKpiTrendMonth:
    def test_month_one_row_per_calendar_month(self, headers):
        r = _get("/api/analytics/kpi-trend", headers,
                 params={"date_from": "2026-01-01", "date_to": "2026-03-31",
                         "country": "Kenya", "bucket": "month"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert len(rows) == 3, f"expected 3 monthly rows, got {len(rows)}"
        labels = [row["label"] for row in rows]
        assert labels[0] == "Jan 2026", labels
        assert labels[1] == "Feb 2026", labels
        assert labels[2] == "Mar 2026", labels


# ─────────────────── QUARTER bucket ───────────────────
class TestKpiTrendQuarter:
    def test_quarter_label_format(self, headers):
        r = _get("/api/analytics/kpi-trend", headers,
                 params={"date_from": "2026-01-01", "date_to": "2026-03-31",
                         "country": "Kenya", "bucket": "quarter"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert len(rows) == 1, f"expected 1 quarterly row Q1 2026, got {len(rows)}"
        assert rows[0]["label"] == "Q1 2026", rows[0]["label"]


# ─────────────────── CSV country filter ───────────────────
class TestKpiTrendCsvCountry:
    def test_csv_country_sums_to_individual(self, headers):
        df, dt = "2026-01-15", "2026-01-17"
        rk = _get("/api/analytics/kpi-trend", headers,
                  params={"date_from": df, "date_to": dt,
                          "country": "Kenya", "bucket": "day"})
        ru = _get("/api/analytics/kpi-trend", headers,
                  params={"date_from": df, "date_to": dt,
                          "country": "Uganda", "bucket": "day"})
        rb = _get("/api/analytics/kpi-trend", headers,
                  params={"date_from": df, "date_to": dt,
                          "country": "Kenya,Uganda", "bucket": "day"})
        assert rk.status_code == ru.status_code == rb.status_code == 200, \
            (rk.text[:200], ru.text[:200], rb.text[:200])
        sk = sum(row.get("total_sales") or 0 for row in rk.json())
        su = sum(row.get("total_sales") or 0 for row in ru.json())
        sb = sum(row.get("total_sales") or 0 for row in rb.json())
        if sk + su == 0 and sb == 0:
            pytest.skip("no data in window for either country")
        rel = abs(sb - (sk + su)) / max(1.0, abs(sk + su))
        assert rel <= 0.02, f"CSV {sb} != Kenya {sk} + Uganda {su} (drift {rel:.3%})"
