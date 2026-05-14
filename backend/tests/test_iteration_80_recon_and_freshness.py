"""Iteration 80 — Recon zero-failures + Country Split match + Snapshot freshness pill.

Covers the spec items from the user's Part 1 + Part 2 brief:

  PART 1 #3 — Recon must show 0 failures.
  PART 1 #6 — `/api/admin/snapshot-freshness` exists, returns age_sec.
  PART 2     — KPI Total Sales == Country Split row for every country.
"""
import os
import time
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")


def _token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


def _hdrs() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def test_recon_zero_failures():
    """All 6 reconciliation checks must pass for today's window."""
    r = requests.get(
        f"{BASE_URL}/api/admin/reconciliation-check",
        headers=_hdrs(), timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    failed = [c for c in body.get("checks", []) if c.get("ok") is False]
    assert not failed, (
        f"Recon has {len(failed)} failures: "
        + ", ".join(c["name"] for c in failed)
    )
    assert body.get("ok") is True, body


def test_kpi_card_matches_country_split():
    """KPI card Total Sales for each country must equal that country's
    row in /api/country-summary on the same window.

    This is the exact bug the user reported (Kenya KPI 808,510 vs
    Country Split 1,132,160). Run on TODAY's window across the 5
    country filter combinations.
    """
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    cs = requests.get(
        f"{BASE_URL}/api/country-summary?date_from={today}&date_to={today}",
        headers=h, timeout=30,
    ).json()
    cs_map = {r["country"]: float(r["total_sales"]) for r in cs}
    for c in ("Kenya", "Uganda", "Rwanda", "Online"):
        if c not in cs_map:
            continue  # no sales that country today
        k = requests.get(
            f"{BASE_URL}/api/kpis?date_from={today}&date_to={today}&country={c}",
            headers=h, timeout=30,
        ).json()
        kpi_total = float(k.get("total_sales") or 0)
        cs_total = cs_map[c]
        # Tolerance: 1 KES (rounding) — should match exactly when both
        # come from the same /kpis snapshot batch.
        assert abs(kpi_total - cs_total) <= 1, (
            f"{c}: KPI={kpi_total} vs Country Split={cs_total} "
            f"(Δ={kpi_total - cs_total:.2f})"
        )


def test_kpi_aggregate_matches_country_sum():
    """/kpis (no country) total must equal Σ(country-summary rows)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    cs = requests.get(
        f"{BASE_URL}/api/country-summary?date_from={today}&date_to={today}",
        headers=h, timeout=30,
    ).json()
    cs_sum = sum(float(r.get("total_sales") or 0) for r in cs)
    k_all = requests.get(
        f"{BASE_URL}/api/kpis?date_from={today}&date_to={today}",
        headers=h, timeout=30,
    ).json()
    kpi_all = float(k_all.get("total_sales") or 0)
    # Tighter tolerance now that both derive from the same snapshot batch.
    assert abs(kpi_all - cs_sum) <= 1, (
        f"/kpis(all)={kpi_all:.0f} vs Σcountry={cs_sum:.0f}"
    )


def test_snapshot_freshness_pill_endpoint():
    """`/api/admin/snapshot-freshness` powers the topbar pill — must
    return age_sec and fresh booleans (auth required, not admin)."""
    r = requests.get(
        f"{BASE_URL}/api/admin/snapshot-freshness",
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "age_sec" in body
    assert "fresh" in body
    # If snapshotter has run at least once today the age should be a
    # positive int below 1 hour (we refresh every 2 min).
    age = body.get("age_sec")
    if age is not None:
        assert age >= 0
        assert age < 3600, f"Snapshot too stale: {age}s"


def test_country_summary_orders_units_reconcile():
    """Orders + units (not just sales) must also reconcile."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()
    cs = requests.get(
        f"{BASE_URL}/api/country-summary?date_from={today}&date_to={today}",
        headers=h, timeout=30,
    ).json()
    cs_orders = sum(int(r.get("orders") or 0) for r in cs)
    cs_units = sum(int(r.get("units_sold") or 0) for r in cs)
    k = requests.get(
        f"{BASE_URL}/api/kpis?date_from={today}&date_to={today}",
        headers=h, timeout=30,
    ).json()
    assert int(k.get("total_orders") or 0) == cs_orders
    assert int(k.get("total_units") or 0) == cs_units
