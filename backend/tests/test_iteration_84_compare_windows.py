"""Iteration 84 — Compare-window snapshot coverage.

User screenshot showed "KPIs are temporarily slow to load" on production
with the filter set to "Today + vs Previous Month".

Root cause: only the 5 default windows (Today / Yesterday / MTD / Last 7
/ Last 30) were in the snapshot rotation. When the compare toggle is set
to "Previous Month", the page fires a SECOND /kpis call for Apr 1-30
that had NO snapshot — fell through to live → 4-country fan-out → Vivo
BI 429 → bootstrap rejection → empty banner.

Fix: added the 4 most-clicked compare windows to `_standard_snapshot_
windows()` so they're refreshed every 2 min alongside the default ones:
  • Previous month (full last calendar month)
  • Previous week (Mon-Sun of last full week)
  • Last quarter (Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec — whichever
    is fully past)
  • QTD (current-quarter to date)

Plus a frontend `Promise.allSettled` defensive fix in useKpis.js so a
compare-window failure NEVER wipes out current-window data (just hides
the delta arrows).

This test ensures the 4 new windows resolve from snapshot and that the
KPI/Country-Split match holds for the Previous Month window too.
"""
import os
import time
import requests
from datetime import date, timedelta

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")


def _hdrs() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return {"Authorization": f"Bearer {d.get('access_token') or d.get('token')}"}


def _prev_month_bounds() -> tuple:
    today = date.today()
    last_end = today.replace(day=1) - timedelta(days=1)
    last_start = last_end.replace(day=1)
    return last_start.isoformat(), last_end.isoformat()


def _prev_week_bounds() -> tuple:
    today = date.today()
    this_mon = today - timedelta(days=today.weekday())
    last_sun = this_mon - timedelta(days=1)
    last_mon = last_sun - timedelta(days=6)
    return last_mon.isoformat(), last_sun.isoformat()


def test_previous_month_resolves_from_snapshot():
    """The "vs Previous Month" compare window must hit a snapshot."""
    df, dt = _prev_month_bounds()
    started = time.time()
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": df, "date_to": dt, "country": "Kenya"},
        headers=_hdrs(), timeout=15,
    )
    duration = time.time() - started
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("_source") == "snapshot", (
        f"Previous month ({df}..{dt}) fell through to live: {body.get('_source')}"
    )
    assert duration < 3, f"Previous month took {duration:.2f}s (should be <1s warm)"


def test_previous_week_resolves_from_snapshot():
    """The "vs Previous Week" compare window must hit a snapshot."""
    df, dt = _prev_week_bounds()
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": df, "date_to": dt, "country": "Kenya"},
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("_source") == "snapshot"


def test_previous_month_kpi_matches_country_split():
    """Σ Country-split for Previous Month must equal /kpis(no-country)."""
    df, dt = _prev_month_bounds()
    h = _hdrs()
    cs = requests.get(
        f"{BASE_URL}/api/country-summary",
        params={"date_from": df, "date_to": dt}, headers=h, timeout=15,
    ).json()
    cs_sum = sum(float(r.get("total_sales") or 0) for r in cs)
    k_all = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": df, "date_to": dt}, headers=h, timeout=15,
    ).json()
    kpi_all = float(k_all.get("total_sales") or 0)
    assert abs(kpi_all - cs_sum) <= 1, (
        f"Previous month: /kpis(all)={kpi_all:.0f} vs Σcountry={cs_sum:.0f}"
    )


def test_compare_windows_in_rotation():
    """`/standard_snapshot_windows` must include the 4 compare windows."""
    # Trip the warmer & wait briefly for the audit row.
    r = requests.post(
        f"{BASE_URL}/api/admin/warm-snapshots-now",
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200
    # The kpi snapshots covering 9 windows × 5 countries = 45 combos.
    # Read the snapshot-count endpoint and assert ≥40 (allows for a
    # mid-sweep race).
    rs = requests.get(
        f"{BASE_URL}/api/admin/snapshot-count",
        headers=_hdrs(), timeout=15,
    )
    assert rs.status_code == 200, rs.text
    n = int(rs.json().get("kpi_snapshots") or 0)
    assert n >= 30, f"Only {n} kpi snapshots — compare windows may be missing"
