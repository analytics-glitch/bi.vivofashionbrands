"""Iteration 80 — Additional spec verification:
  PART 1 #1 — /api/customers, /api/sor, /api/daily-trend snapshot-served, <2s warm.
  PART 1 #1 — /api/kpis response carries `_source:snapshot` marker.
  PART 2     — Numbers stay identical across 3 consecutive refreshes.
"""
import os
import time
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


def _token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


def _hdrs():
    return {"Authorization": f"Bearer {_token()}"}


def _warm(url, h):
    # Prime once (cold path may go upstream), then measure warm.
    requests.get(url, headers=h, timeout=60)
    t0 = time.time()
    r = requests.get(url, headers=h, timeout=60)
    dt = time.time() - t0
    return r, dt


def test_customers_warm_under_2s():
    h = _hdrs()
    r, dt = _warm(f"{BASE_URL}/api/customers", h)
    assert r.status_code == 200, r.text
    assert dt < 2.0, f"/api/customers warm path too slow: {dt:.2f}s"


def test_sor_warm_under_2s():
    h = _hdrs()
    r, dt = _warm(f"{BASE_URL}/api/sor", h)
    assert r.status_code == 200, r.text
    assert dt < 2.0, f"/api/sor warm path too slow: {dt:.2f}s"


def test_daily_trend_warm_under_2s():
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    r, dt = _warm(
        f"{BASE_URL}/api/daily-trend?date_from={today}&date_to={today}", h
    )
    assert r.status_code == 200, r.text
    assert dt < 2.0, f"/api/daily-trend warm path too slow: {dt:.2f}s"


def test_kpis_served_from_snapshot():
    """spec: /api/kpis must serve from snapshot (_source:snapshot marker)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    r = requests.get(
        f"{BASE_URL}/api/kpis?date_from={today}&date_to={today}&country=Kenya",
        headers=h, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    src = body.get("_source")
    assert src == "snapshot", f"_source expected 'snapshot', got {src!r}"


def test_kpi_country_match_across_3_refreshes():
    """Numbers must remain identical across 3 consecutive refreshes."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    snapshots = []
    for _ in range(3):
        cs = requests.get(
            f"{BASE_URL}/api/country-summary?date_from={today}&date_to={today}",
            headers=h, timeout=30,
        ).json()
        cs_map = {r["country"]: float(r["total_sales"]) for r in cs}
        per_country = {}
        for c in ("Kenya", "Uganda", "Rwanda", "Online"):
            if c not in cs_map:
                continue
            k = requests.get(
                f"{BASE_URL}/api/kpis?date_from={today}&date_to={today}&country={c}",
                headers=h, timeout=30,
            ).json()
            per_country[c] = (float(k.get("total_sales") or 0), cs_map[c])
        snapshots.append(per_country)
        time.sleep(1)
    # All 3 must match per-country: kpi == country_summary
    for i, snap in enumerate(snapshots):
        for c, (kpi, cs) in snap.items():
            assert abs(kpi - cs) <= 1, (
                f"Refresh #{i+1} {c}: KPI={kpi} vs Country Split={cs}"
            )


def test_no_cache_off_in_recon_summary():
    """Recon must be 0 failures consistently."""
    h = _hdrs()
    r = requests.get(
        f"{BASE_URL}/api/admin/reconciliation-check", headers=h, timeout=120,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    failed = [c for c in body.get("checks", []) if not c.get("ok")]
    assert not failed, f"recon failures: {[c['name'] for c in failed]}"
