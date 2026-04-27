"""
Global search (⌘K palette) — cross-entity search across stores, styles,
and customers.

Upstream data sources used:
  - /locations           — store list (cached 5m)
  - /top-skus            — style corpus (cached 2m, scope = last 28 days)
  - /customer-search     — pass-through (upstream handles ranking)

Pages are returned from a static list so the palette can navigate the
user directly to any dashboard page.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, User

router = APIRouter(prefix="/api/search", tags=["search"])


# ─── page registry ───────────────────────────────────────────────────

PAGES: List[Dict[str, str]] = [
    {"label": "Overview",       "link": "/",             "hint": "KPIs, daily briefing, winners"},
    {"label": "Locations",      "link": "/locations",    "hint": "Store leaderboard + deep dive"},
    {"label": "Footfall",       "link": "/footfall",     "hint": "Traffic, conversion, weekday pattern"},
    {"label": "Customers",      "link": "/customers",    "hint": "Top customers, churn, cohorts"},
    {"label": "Products",       "link": "/products",     "hint": "Styles, SOR, top sellers"},
    {"label": "Inventory",      "link": "/inventory",    "hint": "Stock, weeks-of-cover, aging"},
    {"label": "Re-Order",       "link": "/re-order",     "hint": "Styles to replenish"},
    {"label": "IBT",            "link": "/ibt",          "hint": "Inter-branch transfers"},
    {"label": "Pricing",        "link": "/pricing",      "hint": "Price changes & elasticity"},
    {"label": "CEO Report",     "link": "/ceo-report",   "hint": "Weekly / monthly executive view"},
    {"label": "Data Quality",   "link": "/data-quality", "hint": "Anomalies + mark-investigated"},
    {"label": "Exports",        "link": "/exports",      "hint": "Sales & inventory CSVs"},
]


# ─── caches ──────────────────────────────────────────────────────────

_cache: Dict[str, Any] = {
    "locations": {"ts": 0.0, "data": []},
    "styles":    {"ts": 0.0, "data": []},
}
_LOCATIONS_TTL = 300.0   # 5m
_STYLES_TTL = 120.0      # 2m


async def _get_locations_corpus() -> List[Dict[str, Any]]:
    now = time.time()
    if _cache["locations"]["data"] and now - _cache["locations"]["ts"] < _LOCATIONS_TTL:
        return _cache["locations"]["data"]
    from server import fetch  # late import
    try:
        rows = await fetch("/locations", {})
    except Exception:
        return _cache["locations"]["data"] or []
    corpus = []
    for r in rows or []:
        name = r.get("location") or r.get("location_name") or r.get("pos_location") or r.get("name")
        if not name:
            continue
        corpus.append({
            "name": name,
            "country": r.get("country") or "",
            "channel": r.get("channel") or r.get("sales_channel") or "",
        })
    _cache["locations"] = {"ts": now, "data": corpus}
    return corpus


async def _get_styles_corpus() -> List[Dict[str, Any]]:
    now = time.time()
    if _cache["styles"]["data"] and now - _cache["styles"]["ts"] < _STYLES_TTL:
        return _cache["styles"]["data"]
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=28)
    try:
        rows = await fetch("/top-skus", {
            "date_from": df.isoformat(),
            "date_to": dt.isoformat(),
            "limit": 2000,
        })
    except Exception:
        return _cache["styles"]["data"] or []
    seen: Dict[str, Dict[str, Any]] = {}
    for r in rows or []:
        style = r.get("style_name")
        if not style or style in seen:
            continue
        seen[style] = {
            "style_name": style,
            "brand": r.get("brand") or "",
            "subcategory": r.get("product_type") or "",
            "units_sold": r.get("units_sold") or 0,
        }
    corpus = list(seen.values())
    _cache["styles"] = {"ts": now, "data": corpus}
    return corpus


# ─── routes ─────────────────────────────────────────────────────────

@router.get("")
async def global_search(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(5, ge=1, le=20),
    _: User = Depends(get_current_user),
):
    """Return grouped matches for `q`: pages, stores, styles, customers.
    All matchers are case-insensitive substring."""
    needle = q.strip().lower()
    if not needle:
        raise HTTPException(status_code=400, detail="q is required")

    # Pages — match on label or hint.
    page_matches: List[Dict[str, Any]] = []
    for p in PAGES:
        hay = f"{p['label']} {p['hint']}".lower()
        if needle in hay:
            page_matches.append({
                "label": p["label"],
                "hint": p["hint"],
                "link": p["link"],
            })

    # Stores.
    stores = await _get_locations_corpus()
    store_matches: List[Dict[str, Any]] = []
    for s in stores:
        hay = f"{s['name']} {s['country']}".lower()
        if needle in hay:
            store_matches.append({
                "name": s["name"],
                "country": s["country"],
                "link": f"/locations?focus={s['name']}",
            })
            if len(store_matches) >= limit:
                break

    # Styles.
    styles = await _get_styles_corpus()
    style_matches: List[Dict[str, Any]] = []
    for s in styles:
        hay = f"{s['style_name']} {s['brand']} {s['subcategory']}".lower()
        if needle in hay:
            style_matches.append({
                "style_name": s["style_name"],
                "brand": s["brand"],
                "subcategory": s["subcategory"],
                "link": "/products",
            })
            if len(style_matches) >= limit:
                break

    # Customers — delegate to upstream /customer-search. This is the
    # slowest link in the chain (cold-cache 1.5–3 s upstream). Run in
    # parallel with the local matchers, time-box to 1.2 s, and skip
    # entirely for very short queries (would match too much anyway).
    customer_matches: List[Dict[str, Any]] = []
    if len(needle) >= 3:
        try:
            from server import fetch  # late import
            import asyncio as _asyncio
            dt = datetime.now(timezone.utc).date()
            df = dt - timedelta(days=365)
            cust_rows = await _asyncio.wait_for(
                fetch("/customer-search", {
                    "q": q, "date_from": df.isoformat(), "date_to": dt.isoformat(),
                }),
                timeout=1.2,
            )
            for c in (cust_rows or [])[:limit]:
                customer_matches.append({
                    "customer_id": c.get("customer_id") or c.get("partner_id"),
                    "customer_name": c.get("customer_name") or c.get("name") or "—",
                    "phone": c.get("phone") or c.get("phone_masked"),
                    "total_spend": c.get("total_spend"),
                    "link": "/customers",
                })
        except Exception:
            customer_matches = []

    return {
        "q": q,
        "pages":     page_matches[:limit],
        "stores":    store_matches,
        "styles":    style_matches,
        "customers": customer_matches,
        "total": len(page_matches) + len(store_matches) + len(style_matches) + len(customer_matches),
    }


@router.get("/customers")
async def search_customers(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(5, ge=1, le=20),
    _: User = Depends(get_current_user),
):
    """Customer-only search. Split out of the main /search payload so
    the frontend can render the fast (pages/stores/styles) groups in
    ~200 ms while the slower upstream /customer-search (cold 1.5–3 s)
    streams in separately. The same upstream call is shared so the
    fetch() cache covers both endpoints."""
    needle = q.strip()
    if len(needle) < 3:
        return {"q": q, "customers": []}
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=365)
    try:
        rows = await fetch("/customer-search", {
            "q": needle,
            "date_from": df.isoformat(),
            "date_to": dt.isoformat(),
        })
    except Exception:
        return {"q": q, "customers": []}
    customers = []
    for c in (rows or [])[:limit]:
        customers.append({
            "customer_id": c.get("customer_id") or c.get("partner_id"),
            "customer_name": c.get("customer_name") or c.get("name") or "—",
            "phone": c.get("phone") or c.get("phone_masked"),
            "total_spend": c.get("total_spend"),
            "link": "/customers",
        })
    return {"q": q, "customers": customers}
