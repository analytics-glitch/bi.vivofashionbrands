from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from collections import defaultdict
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

VIVO_API_BASE = "https://vivo-bi-api-666430550422.europe-west1.run.app"

app = FastAPI(title="Vivo BI Dashboard API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# A shared async HTTP client
_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=VIVO_API_BASE,
            timeout=httpx.Timeout(30.0, connect=10.0),
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
        logger.error(f"Upstream {path} failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Upstream error: {e.response.text}")
    except httpx.HTTPError as e:
        logger.error(f"Upstream {path} connection error: {e}")
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {str(e)}")


# -------------------- Proxy endpoints --------------------
@api_router.get("/")
async def root():
    return {"message": "Vivo BI Dashboard API", "status": "ok"}


@api_router.get("/locations")
async def get_locations():
    return await fetch("/locations")


@api_router.get("/sales")
async def get_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_id: Optional[str] = None,
    location: Optional[str] = None,
    product: Optional[str] = None,
):
    return await fetch("/sales", {
        "date_from": date_from,
        "date_to": date_to,
        "store_id": store_id,
        "location": location,
        "product": product,
    })


@api_router.get("/inventory")
async def get_inventory(
    location: Optional[str] = None,
    product: Optional[str] = None,
    country: Optional[str] = None,
):
    return await fetch("/inventory", {
        "location": location,
        "product": product,
        "country": country,
    })


@api_router.get("/sales-summary")
async def get_sales_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    return await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to})


# -------------------- Helpers --------------------
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


# -------------------- Analytics endpoints --------------------
@api_router.get("/analytics/overview")
async def analytics_overview(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """High-level KPIs: totals across the group."""
    summary = await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to})

    totals = {
        "total_orders": 0,
        "units_sold": 0,
        "gross_sales": 0.0,
        "net_sales": 0.0,
        "returns": 0.0,
        "discounts": 0.0,
        "active_locations": 0,
        "countries": 0,
    }
    countries_set = set()
    for row in summary or []:
        totals["total_orders"] += row.get("total_orders") or 0
        totals["units_sold"] += row.get("units_sold") or 0
        totals["gross_sales"] += row.get("gross_sales") or 0
        totals["net_sales"] += row.get("net_sales") or 0
        totals["returns"] += row.get("returns") or 0
        totals["discounts"] += row.get("discounts") or 0
        if row.get("location"):
            totals["active_locations"] += 1
        countries_set.add(_store_to_country(row.get("store_id")))

    totals["countries"] = len(countries_set)
    # avg order value in net sales
    totals["avg_order_value"] = (totals["net_sales"] / totals["total_orders"]) if totals["total_orders"] else 0.0
    totals["discount_rate"] = (totals["discounts"] / totals["gross_sales"] * 100) if totals["gross_sales"] else 0.0

    return totals


@api_router.get("/analytics/by-country")
async def analytics_by_country(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    summary = await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to})
    agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {
        "country": "",
        "gross_sales": 0.0,
        "net_sales": 0.0,
        "units_sold": 0,
        "total_orders": 0,
        "discounts": 0.0,
        "locations": 0,
    })
    for row in summary or []:
        c = _store_to_country(row.get("store_id"))
        bucket = agg[c]
        bucket["country"] = c
        bucket["gross_sales"] += row.get("gross_sales") or 0
        bucket["net_sales"] += row.get("net_sales") or 0
        bucket["units_sold"] += row.get("units_sold") or 0
        bucket["total_orders"] += row.get("total_orders") or 0
        bucket["discounts"] += row.get("discounts") or 0
        bucket["locations"] += 1
    return sorted(agg.values(), key=lambda x: x["net_sales"], reverse=True)


@api_router.get("/analytics/top-products")
async def analytics_top_products(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(10, ge=1, le=100),
    metric: str = Query("net_sales", regex="^(net_sales|gross_sales|units_sold)$"),
):
    sales = await fetch("/sales", {"date_from": date_from, "date_to": date_to})
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "product_name": "",
        "brand": "",
        "product_type": "",
        "units_sold": 0,
        "gross_sales": 0.0,
        "net_sales": 0.0,
    })
    for row in sales or []:
        name = row.get("product_name") or "Unknown"
        b = agg[name]
        b["product_name"] = name
        b["brand"] = row.get("brand") or b["brand"]
        b["product_type"] = row.get("product_type") or b["product_type"]
        b["units_sold"] += row.get("units_sold") or 0
        b["gross_sales"] += row.get("gross_sales") or 0
        b["net_sales"] += row.get("net_sales") or 0
    return sorted(agg.values(), key=lambda x: x.get(metric) or 0, reverse=True)[:limit]


@api_router.get("/analytics/top-brands")
async def analytics_top_brands(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    sales = await fetch("/sales", {"date_from": date_from, "date_to": date_to})
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"brand": "", "units_sold": 0, "net_sales": 0.0})
    for row in sales or []:
        brand = row.get("brand") or "Unbranded"
        b = agg[brand]
        b["brand"] = brand
        b["units_sold"] += row.get("units_sold") or 0
        b["net_sales"] += row.get("net_sales") or 0
    return sorted(agg.values(), key=lambda x: x["net_sales"], reverse=True)


@api_router.get("/analytics/product-types")
async def analytics_product_types(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    sales = await fetch("/sales", {"date_from": date_from, "date_to": date_to})
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"product_type": "", "units_sold": 0, "net_sales": 0.0})
    for row in sales or []:
        t = row.get("product_type") or "Other"
        b = agg[t]
        b["product_type"] = t
        b["units_sold"] += row.get("units_sold") or 0
        b["net_sales"] += row.get("net_sales") or 0
    return sorted(agg.values(), key=lambda x: x["net_sales"], reverse=True)


@api_router.get("/analytics/inventory-summary")
async def analytics_inventory_summary(
    country: Optional[str] = None,
    location: Optional[str] = None,
):
    inv = await fetch("/inventory", {"country": country, "location": location})

    by_country: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"country": "", "units": 0.0, "skus": 0, "locations": set()})
    by_location: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"location": "", "country": "", "units": 0.0, "skus": 0})
    by_type: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"product_type": "", "units": 0.0})

    total_units = 0.0
    total_skus = 0
    low_stock = 0  # items with available <= 1

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
        if avail <= 1 and row.get("sku"):
            low_stock += 1

    country_list = []
    for c in by_country.values():
        country_list.append({
            "country": c["country"],
            "units": c["units"],
            "skus": c["skus"],
            "locations": len(c["locations"]),
        })

    return {
        "total_units": total_units,
        "total_skus": total_skus,
        "low_stock_skus": low_stock,
        "by_country": sorted(country_list, key=lambda x: x["units"], reverse=True),
        "by_location": sorted(by_location.values(), key=lambda x: x["units"], reverse=True),
        "by_product_type": sorted(by_type.values(), key=lambda x: x["units"], reverse=True)[:12],
    }


@api_router.get("/analytics/low-stock")
async def analytics_low_stock(
    threshold: int = Query(2, ge=0, le=20),
    country: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
):
    inv = await fetch("/inventory", {"country": country})
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
