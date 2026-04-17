from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from collections import defaultdict
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

VIVO_API_BASE = "https://vivo-bi-api-666430550422.europe-west1.run.app"

app = FastAPI(title="Vivo BI Dashboard API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=VIVO_API_BASE,
            timeout=httpx.Timeout(45.0, connect=10.0),
        )
    return _client


async def fetch(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    client = await get_client()
    clean_params = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    try:
        resp = await client.get(path, params=clean_params)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Upstream {path} failed: {e.response.status_code}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Upstream error: {e.response.text}")
    except httpx.HTTPError as e:
        logger.error(f"Upstream {path} connection error: {e}")
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {str(e)}")


def _store_to_country(store_id: Optional[str]) -> str:
    if not store_id:
        return "Other"
    s = store_id.lower()
    if "uganda" in s:
        return "Uganda"
    if "rwanda" in s:
        return "Rwanda"
    if "vivofashiongroup" in s or "kenya" in s:
        return "Kenya"
    return "Other"


EXCLUDE_TOKENS = ("shopping bag", "gift voucher", "gift card", "gift voucher")


def _is_excluded(row: Dict[str, Any]) -> bool:
    name = (row.get("product_name") or "").lower()
    ptype = (row.get("product_type") or "").lower()
    coll = (row.get("collection") or "").lower()
    if "gift voucher" in name or "gift card" in name or "voucher" in ptype:
        return True
    if "shopping bag" in name or "safari shopping" in coll:
        return True
    return False


# -------------------- Proxy endpoints --------------------
@api_router.get("/")
async def root():
    return {"message": "Vivo BI Dashboard API", "status": "ok"}


@api_router.get("/locations")
async def get_locations():
    return await fetch("/locations")


@api_router.get("/kpis")
async def get_kpis(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
):
    return await fetch("/kpis", {
        "date_from": date_from, "date_to": date_to,
        "store_id": store_id, "location": location,
    })


@api_router.get("/sales-summary")
async def get_sales_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
):
    return await fetch("/sales-summary", {
        "date_from": date_from, "date_to": date_to, "store_id": store_id,
    })


@api_router.get("/top-skus")
async def get_top_skus(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
    limit: int = Query(20, ge=1, le=200),
):
    return await fetch("/top-skus", {
        "date_from": date_from, "date_to": date_to,
        "store_id": store_id, "location": location, "limit": limit,
    })


@api_router.get("/sor")
async def get_sor(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
):
    return await fetch("/sor", {
        "date_from": date_from, "date_to": date_to,
        "store_id": store_id, "location": location,
    })


@api_router.get("/daily-trend")
async def get_daily_trend(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
):
    return await fetch("/daily-trend", {
        "date_from": date_from, "date_to": date_to, "store_id": store_id,
    })


@api_router.get("/inventory")
async def get_inventory(
    location: Optional[str] = None,
    product: Optional[str] = None,
    country: Optional[str] = None,
):
    return await fetch("/inventory", {
        "location": location, "product": product, "country": country,
    })


# -------------------- Analytics --------------------
@api_router.get("/analytics/kpis-plus")
async def analytics_kpis_plus(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
):
    """Augmented KPIs incl. units-per-order, return rate, sell-through, and units_clean (excl. bags/vouchers)."""
    params = {
        "date_from": date_from, "date_to": date_to,
        "store_id": store_id, "location": location,
    }
    kpis = await fetch("/kpis", params)
    sor = await fetch("/sor", params)

    # Approximate excluded units via top-skus (upstream no longer exposes /sales line items)
    excluded_units = 0
    try:
        top = await fetch("/top-skus", {**params, "limit": 200})
        for r in top or []:
            if _is_excluded(r):
                excluded_units += r.get("units_sold") or 0
    except HTTPException:
        pass

    total_units = kpis.get("total_units") or 0
    units_clean = max(0, total_units - excluded_units)

    total_orders = kpis.get("total_orders") or 0
    units_per_order = (total_units / total_orders) if total_orders else 0
    gross = kpis.get("total_gross_sales") or 0
    return_rate = ((kpis.get("total_returns") or 0) / gross * 100) if gross else 0.0

    st_units = sum((x.get("units_sold") or 0) for x in sor or [])
    st_stock = sum((x.get("current_stock") or 0) for x in sor or [])
    sell_through = (st_units / (st_units + st_stock) * 100) if (st_units + st_stock) else 0.0

    return {
        **kpis,
        "units_clean": units_clean,
        "units_excluded": excluded_units,
        "units_per_order": units_per_order,
        "return_rate": return_rate,
        "sell_through_rate": sell_through,
    }


@api_router.get("/analytics/highlights")
async def analytics_highlights(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
):
    """Top location, top brand, top collection by gross/total sales."""
    summary = await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to, "store_id": store_id})
    top_loc = None
    if summary:
        filtered = [s for s in summary if (not location or s.get("location") == location)]
        src = filtered or summary
        top_loc = max(src, key=lambda r: r.get("gross_sales") or 0)

    # brand & collection derived from /top-skus (limit 200) and /sor
    top_brand = None
    top_coll = None
    try:
        top = await fetch("/top-skus", {
            "date_from": date_from, "date_to": date_to,
            "store_id": store_id, "location": location, "limit": 200,
        })
        brand_agg: Dict[str, float] = defaultdict(float)
        coll_agg: Dict[str, float] = defaultdict(float)
        for r in top or []:
            ts = r.get("total_sales") or 0
            if r.get("brand"):
                brand_agg[r["brand"]] += ts
            if r.get("collection"):
                coll_agg[r["collection"]] += ts
        if brand_agg:
            top_brand = max(brand_agg.items(), key=lambda x: x[1])
        if coll_agg:
            top_coll = max(coll_agg.items(), key=lambda x: x[1])
    except HTTPException:
        pass

    return {
        "top_location": {
            "name": top_loc["location"] if top_loc else None,
            "country": _store_to_country(top_loc["store_id"]) if top_loc else None,
            "gross_sales": top_loc["gross_sales"] if top_loc else 0,
        } if top_loc else None,
        "top_brand": {"name": top_brand[0], "gross_sales": top_brand[1]} if top_brand else None,
        "top_collection": {"name": top_coll[0], "gross_sales": top_coll[1]} if top_coll else None,
    }


@api_router.get("/analytics/by-country")
async def analytics_by_country(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    summary = await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to})
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "country": "", "gross_sales": 0.0, "net_sales": 0.0,
        "units_sold": 0, "total_orders": 0, "discounts": 0.0, "locations": 0,
    })
    for row in summary or []:
        c = _store_to_country(row.get("store_id"))
        b = agg[c]
        b["country"] = c
        b["gross_sales"] += row.get("gross_sales") or 0
        b["net_sales"] += row.get("net_sales") or 0
        b["units_sold"] += row.get("units_sold") or 0
        b["total_orders"] += row.get("total_orders") or 0
        b["discounts"] += row.get("discounts") or 0
        b["locations"] += 1
    for v in agg.values():
        v["avg_basket_size"] = (v["gross_sales"] / v["total_orders"]) if v["total_orders"] else 0
    return sorted(agg.values(), key=lambda x: x["gross_sales"], reverse=True)


@api_router.get("/analytics/inventory-summary")
async def analytics_inventory_summary(
    country: Optional[str] = None,
    location: Optional[str] = None,
    product: Optional[str] = None,
):
    inv = await fetch("/inventory", {"country": country, "location": location, "product": product})

    by_country: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"country": "", "units": 0.0, "skus": 0, "locations": set()})
    by_location: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"location": "", "country": "", "units": 0.0, "skus": 0})
    by_type: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"product_type": "", "units": 0.0})

    total_units = 0.0
    total_skus = 0
    low_stock = 0

    for row in inv or []:
        c = (row.get("country") or "Unknown").title()
        loc = row.get("location_name") or "Unknown"
        pt = row.get("product_type") or "Other"
        avail = float(row.get("available") or 0)

        by_country[c]["country"] = c
        by_country[c]["units"] += avail
        by_country[c]["skus"] += 1
        by_country[c]["locations"].add(loc)

        key = f"{c}|{loc}"
        by_location[key]["location"] = loc
        by_location[key]["country"] = c
        by_location[key]["units"] += avail
        by_location[key]["skus"] += 1

        by_type[pt]["product_type"] = pt
        by_type[pt]["units"] += avail

        total_units += avail
        total_skus += 1
        if avail <= 2 and row.get("sku"):
            low_stock += 1

    country_list = [{
        "country": c["country"], "units": c["units"],
        "skus": c["skus"], "locations": len(c["locations"]),
    } for c in by_country.values()]

    return {
        "total_units": total_units,
        "total_skus": total_skus,
        "low_stock_skus": low_stock,
        "markets": len(country_list),
        "by_country": sorted(country_list, key=lambda x: x["units"], reverse=True),
        "by_location": sorted(by_location.values(), key=lambda x: x["units"], reverse=True),
        "by_product_type": sorted(by_type.values(), key=lambda x: x["units"], reverse=True),
    }


@api_router.get("/analytics/low-stock")
async def analytics_low_stock(
    threshold: int = Query(2, ge=0, le=20),
    country: Optional[str] = None,
    location: Optional[str] = None,
    product: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    inv = await fetch("/inventory", {"country": country, "location": location, "product": product})
    rows = [
        r for r in (inv or [])
        if r.get("sku") and (r.get("available") or 0) <= threshold
    ]
    rows.sort(key=lambda r: r.get("available") or 0)
    return rows[:limit]


# -------------------- App wiring --------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
