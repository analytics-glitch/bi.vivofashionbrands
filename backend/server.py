import asyncio
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
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    try:
        resp = await client.get(path, params=clean)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Upstream {path} failed: {e.response.status_code}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Upstream error: {e.response.text}")
    except httpx.HTTPError as e:
        logger.error(f"Upstream {path} connection error: {e}")
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {str(e)}")


def _split_csv(val: Optional[str]) -> List[str]:
    if not val:
        return []
    return [x.strip() for x in val.split(",") if x.strip()]


async def multi_fetch(path: str, base: Dict[str, Any], countries: List[str], channels: List[str]) -> List[Any]:
    """Fire requests for each (country,channel) combo in parallel and return list of responses.
    Empty lists mean 'all' for that dimension."""
    countries_iter = countries or [None]
    channels_iter = channels or [None]
    tasks = []
    keys = []
    for c in countries_iter:
        for ch in channels_iter:
            params = {**base}
            if c:
                params["country"] = c
            if ch:
                params["channel"] = ch
            tasks.append(fetch(path, params))
            keys.append((c, ch))
    results = await asyncio.gather(*tasks)
    return results


def agg_kpis(list_of_kpis: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = {
        "total_sales": 0.0, "gross_sales": 0.0, "total_discounts": 0.0,
        "total_returns": 0.0, "net_sales": 0.0,
        "total_orders": 0, "total_units": 0,
    }
    for k in list_of_kpis:
        total["total_sales"] += k.get("total_sales") or 0
        total["gross_sales"] += k.get("gross_sales") or 0
        total["total_discounts"] += k.get("total_discounts") or 0
        total["total_returns"] += k.get("total_returns") or 0
        total["net_sales"] += k.get("net_sales") or 0
        total["total_orders"] += k.get("total_orders") or 0
        total["total_units"] += k.get("total_units") or 0
    total["avg_basket_size"] = (total["total_sales"] / total["total_orders"]) if total["total_orders"] else 0
    total["avg_selling_price"] = (total["total_sales"] / total["total_units"]) if total["total_units"] else 0
    total["return_rate"] = (total["total_returns"] / total["gross_sales"] * 100) if total["gross_sales"] else 0
    return total


# -------------------- Proxy / aggregator endpoints --------------------
@api_router.get("/")
async def root():
    return {"message": "Vivo BI Dashboard API", "status": "ok"}


@api_router.get("/locations")
async def get_locations():
    return await fetch("/locations")


@api_router.get("/country-summary")
async def get_country_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    return await fetch("/country-summary", {"date_from": date_from, "date_to": date_to})


@api_router.get("/kpis")
async def get_kpis(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Supports comma-separated country & channel. Aggregates if more than one combo."""
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        return await fetch("/kpis", {**base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None})
    results = await multi_fetch("/kpis", base, cs, chs)
    return agg_kpis(results)


@api_router.get("/sales-summary")
async def get_sales_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        return await fetch("/sales-summary", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
    # call per (country) and flatten; channel filter applied post-hoc
    tasks = [fetch("/sales-summary", {**base, "country": c}) for c in (cs or [None])]
    groups = await asyncio.gather(*tasks)
    out: List[Dict[str, Any]] = []
    seen = set()
    for g in groups:
        for row in g:
            key = (row.get("channel"), row.get("country"))
            if key in seen:
                continue
            seen.add(key)
            if chs and row.get("channel") not in chs:
                continue
            out.append(row)
    return out


@api_router.get("/top-skus")
async def get_top_skus(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = Query(20, ge=1, le=200),
):
    base = {"date_from": date_from, "date_to": date_to, "limit": max(limit, 50)}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        data = await fetch("/top-skus", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
        return data[:limit]
    results = await multi_fetch("/top-skus", base, cs, chs)
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for row in g:
            sku = row.get("sku")
            if not sku:
                continue
            if sku not in merged:
                merged[sku] = {**row}
            else:
                merged[sku]["units_sold"] = (merged[sku].get("units_sold") or 0) + (row.get("units_sold") or 0)
                merged[sku]["total_sales"] = (merged[sku].get("total_sales") or 0) + (row.get("total_sales") or 0)
                merged[sku]["gross_sales"] = (merged[sku].get("gross_sales") or 0) + (row.get("gross_sales") or 0)
    rows = list(merged.values())
    for r in rows:
        units = r.get("units_sold") or 0
        r["avg_price"] = (r.get("total_sales") or 0) / units if units else 0
    rows.sort(key=lambda r: r.get("total_sales") or 0, reverse=True)
    return rows[:limit]


@api_router.get("/sor")
async def get_sor(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        return await fetch("/sor", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
    results = await multi_fetch("/sor", base, cs, chs)
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for row in g:
            style = row.get("style_name")
            if not style:
                continue
            if style not in merged:
                merged[style] = {**row}
            else:
                for f in ("units_sold", "total_sales", "gross_sales", "current_stock"):
                    merged[style][f] = (merged[style].get(f) or 0) + (row.get(f) or 0)
    rows = list(merged.values())
    for r in rows:
        u = r.get("units_sold") or 0
        st = r.get("current_stock") or 0
        r["sor_percent"] = (u / (u + st) * 100) if (u + st) else 0
    rows.sort(key=lambda r: r.get("sor_percent") or 0, reverse=True)
    return rows


@api_router.get("/daily-trend")
async def get_daily_trend(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    if len(cs) <= 1:
        return await fetch("/daily-trend", {**base, "country": cs[0] if cs else None})
    tasks = [fetch("/daily-trend", {**base, "country": c}) for c in cs]
    results = await asyncio.gather(*tasks)
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for row in g:
            day = row.get("day")
            if day not in merged:
                merged[day] = {"day": day, "orders": 0, "gross_sales": 0.0, "net_sales": 0.0, "total_sales": 0.0}
            merged[day]["orders"] += row.get("orders") or 0
            merged[day]["gross_sales"] += row.get("gross_sales") or 0
            merged[day]["net_sales"] += row.get("net_sales") or 0
            merged[day]["total_sales"] += row.get("total_sales") or row.get("gross_sales") or 0
    out = list(merged.values())
    out.sort(key=lambda r: r["day"])
    return out


@api_router.get("/inventory")
async def get_inventory(
    location: Optional[str] = None,
    product: Optional[str] = None,
    country: Optional[str] = None,
):
    return await fetch("/inventory", {"location": location, "product": product, "country": country})


# -------------------- Aggregation helpers --------------------
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
    warehouse_stock = 0.0

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
        if "warehouse" in loc.lower() or "fg" in loc.lower():
            warehouse_stock += avail

    country_list = [{
        "country": c["country"], "units": c["units"],
        "skus": c["skus"], "locations": len(c["locations"]),
    } for c in by_country.values()]

    return {
        "total_units": total_units,
        "total_skus": total_skus,
        "low_stock_skus": low_stock,
        "warehouse_fg_stock": warehouse_stock,
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
    limit: int = Query(300, ge=1, le=3000),
):
    inv = await fetch("/inventory", {"country": country, "location": location, "product": product})
    rows = [
        r for r in (inv or [])
        if r.get("sku") and (r.get("available") or 0) <= threshold
    ]
    rows.sort(key=lambda r: r.get("available") or 0)
    return rows[:limit]


@api_router.get("/analytics/returns")
async def analytics_returns(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Top channels and SKUs by returns KES."""
    summary = await get_sales_summary(date_from, date_to, country, channel)  # reuse
    top_channels = sorted(
        (x for x in summary if (x.get("returns") or 0) > 0),
        key=lambda x: x.get("returns") or 0, reverse=True,
    )[:5]
    # top SKUs by returns — upstream top-skus doesn't expose returns per SKU
    # We fall back to showing top SKUs by units as "at risk" proxy.
    return {"top_channels": top_channels}


@api_router.get("/analytics/insights")
async def analytics_insights(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Auto-generate a short paragraph for the CEO report."""
    countries_now = await fetch("/country-summary", {"date_from": date_from, "date_to": date_to})
    kpis_now = await fetch("/kpis", {"date_from": date_from, "date_to": date_to})

    # compute last month window
    from datetime import date
    def shift_iso(iso: str, years: int, months: int) -> str:
        y, m, d = [int(x) for x in iso.split("-")]
        m_total = y * 12 + (m - 1) + months
        ny, nm = m_total // 12, (m_total % 12) + 1
        ny += years
        import calendar
        last_day = calendar.monthrange(ny, nm)[1]
        return f"{ny:04d}-{nm:02d}-{min(d, last_day):02d}"

    lm_from = shift_iso(date_from, 0, -1) if date_from else None
    lm_to = shift_iso(date_to, 0, -1) if date_to else None
    kpis_lm = await fetch("/kpis", {"date_from": lm_from, "date_to": lm_to}) if lm_from else None

    # find top country & store
    top_country = max(countries_now, key=lambda c: c.get("total_sales") or 0) if countries_now else None
    total_sales_now = sum((c.get("total_sales") or 0) for c in countries_now) or 1
    top_pct = (top_country.get("total_sales") / total_sales_now * 100) if top_country else 0

    summary = await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to})
    top_store = max(summary, key=lambda r: r.get("total_sales") or 0) if summary else None

    def delta(cur, prev):
        if not prev or prev == 0:
            return None
        return (cur - prev) / prev * 100

    rr_now = kpis_now.get("return_rate") or 0
    rr_lm = kpis_lm.get("return_rate") if kpis_lm else None
    bs_now = kpis_now.get("avg_basket_size") or 0
    bs_lm = kpis_lm.get("avg_basket_size") if kpis_lm else None
    bs_delta = delta(bs_now, bs_lm) if bs_lm else None

    parts = []
    if top_country:
        parts.append(f"{top_country['country']} contributed {top_pct:.1f}% of Group Total Sales.")
    if top_store:
        parts.append(
            f"The top performing store was {top_store['channel']} ({top_store['country']}) with KES {int(top_store['total_sales']):,}."
        )
    if rr_lm is not None:
        if rr_now > rr_lm + 0.1:
            parts.append(f"Return rate rose to {rr_now:.2f}% (was {rr_lm:.2f}% last month).")
        elif rr_now < rr_lm - 0.1:
            parts.append(f"Return rate improved to {rr_now:.2f}% (from {rr_lm:.2f}% last month).")
        else:
            parts.append(f"Return rate held stable at {rr_now:.2f}% vs {rr_lm:.2f}% last month.")
    else:
        parts.append(f"Return rate was {rr_now:.2f}%.")
    if bs_delta is not None:
        direction = "grew" if bs_delta > 0 else "declined"
        parts.append(f"Average basket size {direction} {abs(bs_delta):.1f}% vs last month (KES {int(bs_now):,}).")

    return {"text": " ".join(parts), "top_country": top_country, "top_store": top_store}


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
