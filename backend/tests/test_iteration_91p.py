"""
Iteration 91p backend tests:
- ISS-001: /api/exec-summary YTD & MTD revenue/units must reconcile with /api/kpis
- ISS-001: country-scoped reconciliation (Kenya)
- ISS-013: heavy_guard limit for /analytics/replenishment-report bumped to 2
- ISS-013: 2 concurrent replenishment-report calls — neither should 503

Auth: admin login via /api/auth/login (admin@vivofashiongroup.com / VivoAdmin!2026).
"""
import os
import datetime as dt
import threading
from typing import Dict, Tuple

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to frontend/.env
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS  = "VivoAdmin!2026"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="session")
def auth_headers(admin_token) -> Dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Helpers ----------
def _eat_today() -> dt.date:
    # EAT = UTC+3
    return (dt.datetime.utcnow() + dt.timedelta(hours=3)).date()


def _ytd_window() -> Tuple[str, str]:
    today = _eat_today()
    yesterday = today - dt.timedelta(days=1)
    return f"{today.year}-01-01", yesterday.isoformat()


def _mtd_window() -> Tuple[str, str]:
    today = _eat_today()
    yesterday = today - dt.timedelta(days=1)
    mtd_from = today.replace(day=1)
    mtd_to = max(mtd_from, yesterday)
    return mtd_from.isoformat(), mtd_to.isoformat()


def _fetch_exec(headers, df, dt_, country=None):
    params = {"date_from": df, "date_to": dt_}
    if country:
        params["country"] = country
    r = requests.get(f"{BASE_URL}/api/exec-summary",
                     params=params, headers=headers, timeout=120)
    assert r.status_code == 200, f"exec-summary {r.status_code}: {r.text[:300]}"
    return r.json()


def _fetch_kpis(headers, df, dt_, country=None):
    params = {"date_from": df, "date_to": dt_}
    if country:
        params["country"] = country
    r = requests.get(f"{BASE_URL}/api/kpis",
                     params=params, headers=headers, timeout=120)
    assert r.status_code == 200, f"/kpis {r.status_code}: {r.text[:300]}"
    return r.json()


# ---------- ISS-001 reconciliation ----------
class TestISS001Reconciliation:
    """Exec-Summary headline tiles must come from canonical /kpis source."""

    def test_ytd_revenue_units_reconcile(self, auth_headers):
        df, dt_ = _ytd_window()
        ex = _fetch_exec(auth_headers, df, dt_)
        kp = _fetch_kpis(auth_headers, df, dt_)
        ytd_k = (ex.get("ytd") or {}).get("kpis") or {}
        rev_ex = float(((ytd_k.get("revenue") or {}).get("cur")) or 0)
        units_ex = float(((ytd_k.get("units") or {}).get("cur")) or 0)
        rev_kp = float(kp.get("total_sales") or 0)
        units_kp = float(kp.get("total_units") or 0)
        # Allow 1 KES / 1 unit tolerance for FP rounding.
        assert abs(rev_ex - rev_kp) < 1.0, (
            f"YTD revenue diverged: exec={rev_ex} kpis={rev_kp} window=[{df},{dt_}]"
        )
        assert abs(units_ex - units_kp) < 1.0, (
            f"YTD units diverged: exec={units_ex} kpis={units_kp} window=[{df},{dt_}]"
        )

    def test_mtd_revenue_units_reconcile(self, auth_headers):
        df, dt_ = _mtd_window()
        ex = _fetch_exec(auth_headers, df, dt_)
        kp = _fetch_kpis(auth_headers, df, dt_)
        mtd_k = (ex.get("mtd") or {}).get("kpis") or {}
        rev_ex = float(((mtd_k.get("revenue") or {}).get("cur")) or 0)
        units_ex = float(((mtd_k.get("units") or {}).get("cur")) or 0)
        rev_kp = float(kp.get("total_sales") or 0)
        units_kp = float(kp.get("total_units") or 0)
        assert abs(rev_ex - rev_kp) < 1.0, (
            f"MTD revenue diverged: exec={rev_ex} kpis={rev_kp} window=[{df},{dt_}]"
        )
        assert abs(units_ex - units_kp) < 1.0, (
            f"MTD units diverged: exec={units_ex} kpis={units_kp} window=[{df},{dt_}]"
        )

    def test_ytd_country_kenya_reconcile(self, auth_headers):
        df, dt_ = _ytd_window()
        ex = _fetch_exec(auth_headers, df, dt_, country="Kenya")
        kp = _fetch_kpis(auth_headers, df, dt_, country="Kenya")
        ytd_k = (ex.get("ytd") or {}).get("kpis") or {}
        rev_ex = float(((ytd_k.get("revenue") or {}).get("cur")) or 0)
        rev_kp = float(kp.get("total_sales") or 0)
        assert abs(rev_ex - rev_kp) < 1.0, (
            f"Kenya YTD revenue diverged: exec={rev_ex} kpis={rev_kp}"
        )


# ---------- ISS-013 heavy guard ----------
class TestISS013HeavyGuard:
    """Replenishment-report limit raised from 1 → 2."""

    def test_cache_stats_reports_limit_2(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/admin/cache-stats",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        hg = body.get("heavy_guard") or {}
        limits = hg.get("limits") or {}
        # The key may be present with or without leading slash.
        repl_limit = (
            limits.get("/analytics/replenishment-report")
            or limits.get("analytics/replenishment-report")
        )
        assert repl_limit == 2, (
            f"Expected replenishment-report limit=2, got {repl_limit}; "
            f"full limits={limits}"
        )

    def test_two_concurrent_replenishment_no_503(self, auth_headers):
        """Submit 2 concurrent requests with different params → neither 503."""
        today = _eat_today()
        yesterday = today - dt.timedelta(days=1)
        two_days_ago = today - dt.timedelta(days=2)
        params_a = {"date_from": yesterday.isoformat(), "date_to": today.isoformat()}
        params_b = {"date_from": two_days_ago.isoformat(), "date_to": yesterday.isoformat()}
        results: Dict[str, int] = {}
        errs: Dict[str, str] = {}

        def _hit(name, params):
            try:
                r = requests.get(
                    f"{BASE_URL}/api/analytics/replenishment-report",
                    params=params, headers=auth_headers, timeout=120,
                )
                results[name] = r.status_code
                if r.status_code >= 400:
                    errs[name] = r.text[:200]
            except Exception as e:  # noqa: BLE001
                results[name] = -1
                errs[name] = str(e)

        ta = threading.Thread(target=_hit, args=("A", params_a))
        tb = threading.Thread(target=_hit, args=("B", params_b))
        ta.start(); tb.start()
        ta.join(); tb.join()

        assert results.get("A") != 503, f"Req A got 503: {errs.get('A')}"
        assert results.get("B") != 503, f"Req B got 503: {errs.get('B')}"
        # Both should be 200 (or at worst 4xx for validation, but never 503).
        assert results.get("A") in (200, 401, 403, 404), (
            f"Req A unexpected status {results.get('A')}: {errs.get('A')}"
        )
        assert results.get("B") in (200, 401, 403, 404), (
            f"Req B unexpected status {results.get('B')}: {errs.get('B')}"
        )
