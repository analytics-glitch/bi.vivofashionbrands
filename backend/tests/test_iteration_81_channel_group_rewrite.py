"""Iteration 81 — Retail / Online channel-group rewrite.

User reported the dashboard showed "KPIs are temporarily slow to load. Auto-
refreshing in the background — you don't need to do anything." with the Retail
toggle ON. Root cause: the Retail toggle expanded to ~15 channel names in a
CSV, and the backend fanned out 4 countries × 15 channels = 60 upstream calls
per request → Vivo BI rate-limited (429) → empty banner.

This test verifies the permanent fix:
  • Retail-shaped channel CSV (≥2 non-online channels) resolves from snapshot
    in < 1 s with `_source == "snapshot"` (no upstream fan-out).
  • Online-shaped channel CSV resolves from snapshot the same way.
  • Σ(Retail) + Σ(Online) == /kpis(no filter) — accounting reconciles.
"""
import os
import time
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")

RETAIL_CSV = ",".join([
    "Vivo Nakuru", "Vivo Sarit", "Vivo Junction", "Vivo Village Market",
    "Vivo Mama Ngina St", "Vivo Kigali Heights", "Vivo Moi Avenue",
    "Vivo Kileleshwa", "Vivo Galleria", "Vivo Capital Centre",
    "Vivo Garden City", "Vivo Two Rivers", "The Oasis Mall",
    "Vivo Westgate",
])
ONLINE_CSV = "Online - Shop Zetu"


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


def test_retail_channel_group_uses_snapshot():
    """Retail CSV must resolve from snapshot (no upstream fan-out)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    started = time.time()
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": today, "date_to": today, "channel": RETAIL_CSV},
        headers=_hdrs(), timeout=15,
    )
    duration = time.time() - started
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("_source") == "snapshot", (
        f"Retail group fell through to live (would trigger 60-call fan-out): "
        f"{body.get('_source')}"
    )
    assert duration < 3, f"Retail kpis took {duration:.2f}s (should be <1s warm)"


def test_online_channel_group_uses_snapshot():
    """Single online channel must resolve from snapshot (Online country slice)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": today, "date_to": today, "channel": ONLINE_CSV},
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("_source") == "snapshot", (
        f"Online group fell through to live: {body.get('_source')}"
    )


def test_retail_plus_online_equals_all():
    """Σ(Retail) + Σ(Online) must equal /kpis(no filter) to the shilling."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    h = _hdrs()

    def _q(channel: str = None) -> dict:
        params = {"date_from": today, "date_to": today}
        if channel:
            params["channel"] = channel
        return requests.get(
            f"{BASE_URL}/api/kpis", params=params, headers=h, timeout=15,
        ).json()

    all_kpi = _q()
    retail_kpi = _q(RETAIL_CSV)
    online_kpi = _q(ONLINE_CSV)

    sum_sales = float(retail_kpi.get("total_sales") or 0) + float(online_kpi.get("total_sales") or 0)
    sum_orders = int(retail_kpi.get("total_orders") or 0) + int(online_kpi.get("total_orders") or 0)
    assert abs(sum_sales - float(all_kpi.get("total_sales") or 0)) <= 1, (
        f"Retail {retail_kpi.get('total_sales')} + Online {online_kpi.get('total_sales')} "
        f"!= All {all_kpi.get('total_sales')}"
    )
    assert sum_orders == int(all_kpi.get("total_orders") or 0)


def test_country_summary_retail_filter_excludes_online():
    """Country split with Retail filter must omit the Online row."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    r = requests.get(
        f"{BASE_URL}/api/country-summary",
        params={"date_from": today, "date_to": today, "channel": RETAIL_CSV},
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200, r.text
    rows = r.json()
    cnames = {row["country"] for row in rows}
    assert "Online" not in cnames, f"Retail filter still showing Online: {cnames}"
