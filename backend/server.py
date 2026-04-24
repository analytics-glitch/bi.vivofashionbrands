import asyncio
from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any, List
from collections import defaultdict
from datetime import datetime, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

VIVO_API_BASE = os.environ.get(
    "VIVO_API_BASE", "https://vivo-bi-api-666430550422.europe-west1.run.app"
)

from auth import (  # noqa: E402
    auth_router, admin_router, ActivityLogMiddleware,
    get_current_user, seed_admin,
)
from chat import chat_router  # noqa: E402
from pii import mask_and_audit, mask_rows  # noqa: E402

app = FastAPI(title="Vivo BI Dashboard API")
# NB: all business endpoints live under this router and require auth.
api_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_client: Optional[httpx.AsyncClient] = None

# In-memory stale cache for /kpis — used to avoid blank dashboards when the
# upstream BI API is mid-refresh / cold-starting. Key: (date_from, date_to,
# country, channel). Value: (timestamp, data_with_stale_flag=False).
_kpi_stale_cache: Dict[tuple, tuple] = {}

# TTL cache for the full churned-customers list used by the /customers churn-
# rate calculation. Upstream /churned-customers?limit=100000 takes ~30s which
# blocks the Customers page for the entire duration on cold cache. A customer's
# 90-day inactivity status changes at most once per day, so a 30-minute TTL is
# safe. Key: churn_window_days (int). Value: (timestamp, list).
_churn_full_cache: Dict[int, tuple] = {}
_CHURN_FULL_TTL = 1800  # seconds


def _client_ip(request: Request) -> Optional[str]:
    """Best-effort client IP (handles X-Forwarded-For from the ingress)."""
    if not request:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=VIVO_API_BASE,
            timeout=httpx.Timeout(45.0, connect=10.0),
        )
    return _client


async def fetch(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    timeout_sec: Optional[float] = None,
    max_attempts: int = 3,
) -> Any:
    """Fetch with retries on transient network / 5xx errors.

    `timeout_sec` overrides the default 45 s per-call timeout (used by the
    KPI stale-cache path to fail fast and fall back to the last good value).
    `max_attempts` caps the retry budget (default 3).
    """
    client = await get_client()
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    last_err: Optional[Exception] = None
    req_timeout = (
        httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec))
        if timeout_sec is not None
        else None
    )
    for attempt in range(max_attempts):
        try:
            resp = await client.get(path, params=clean, timeout=req_timeout) if req_timeout else await client.get(path, params=clean)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            if 500 <= e.response.status_code < 600 and attempt < max_attempts - 1:
                await asyncio.sleep(0.4 * (attempt + 1))
                last_err = e
                continue
            logger.error(f"Upstream {path} failed: {e.response.status_code}")
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Upstream {path} returned {e.response.status_code}",
            )
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
            last_err = e
            if attempt < max_attempts - 1:
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            logger.error(f"Upstream {path} timeout/connect: {type(e).__name__}: {e}")
            raise HTTPException(
                status_code=504,
                detail=f"Upstream {path} {type(e).__name__}: timed out after {max_attempts} attempts",
            )
        except httpx.HTTPError as e:
            logger.error(f"Upstream {path} connection error: {type(e).__name__}: {e}")
            raise HTTPException(
                status_code=502,
                detail=f"Upstream {path} unreachable ({type(e).__name__}): {str(e) or 'no detail'}",
            )
    # Should never reach here, but be explicit.
    raise HTTPException(
        status_code=502,
        detail=f"Upstream {path} failed after retries: {last_err}",
    )


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
    data = await fetch("/locations") or []
    # Merge in known-but-unlisted inventory locations so the filter can select them.
    existing = {(loc.get("channel"), loc.get("country")) for loc in data}
    for extra in EXTRA_INVENTORY_LOCATIONS:
        if (extra["channel"], extra["country"]) not in existing:
            data.append({
                "channel": extra["channel"],
                "pos_location_name": extra["channel"],
                "country": extra["country"],
            })
    return data


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
    """Supports comma-separated country & channel. Aggregates if more than one combo.

    Hedged path: tries a single upstream attempt with a 30 s per-call timeout
    (2 × 30 s = 60 s max budget, well inside the 120 s frontend timeout).
    On upstream error/timeout, falls back to a short-lived stale cache so the
    dashboard never goes blank during Vivo BI refresh windows / cold starts.
    """
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    cache_key = (date_from or "", date_to or "", country or "", channel or "")
    single = len(cs) <= 1 and len(chs) <= 1

    try:
        if single:
            data = await fetch(
                "/kpis",
                {**base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None},
                timeout_sec=30.0,
                max_attempts=2,
            )
        else:
            # Multi-country/channel fan-out — keep default timeout (more calls,
            # each should still be fast individually) but cap attempts at 2.
            tasks = []
            for c in (cs or [None]):
                for ch in (chs or [None]):
                    params = {**base}
                    if c:
                        params["country"] = c
                    if ch:
                        params["channel"] = ch
                    tasks.append(fetch("/kpis", params, timeout_sec=30.0, max_attempts=2))
            results = await asyncio.gather(*tasks)
            data = agg_kpis(results)
        # Cache the good result. 90 s TTL — long enough to cover a Cloud Run
        # cold start, short enough that numbers are near-real-time.
        data = {**data, "stale": False}
        _kpi_stale_cache[cache_key] = (time.time(), data)
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < 180):  # 3-min window
            stale_data = {**cached[1], "stale": True, "stale_age_sec": int(time.time() - cached[0])}
            logger.warning(f"/kpis upstream {e.status_code} — serving stale cache (age={stale_data['stale_age_sec']}s)")
            return stale_data
        raise


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
    brand: Optional[str] = None,
    limit: int = Query(20, ge=1, le=200),
):
    base = {"date_from": date_from, "date_to": date_to, "limit": max(limit, 50)}
    if brand:
        base["product"] = brand
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        data = await fetch("/top-skus", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
        data = sorted(data or [], key=lambda r: r.get("total_sales") or 0, reverse=True)
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
    brand: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    if brand:
        base["product"] = brand
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        data = await fetch("/sor", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
        return sorted(data or [], key=lambda r: r.get("sor_percent") or 0, reverse=True)
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
    locations: Optional[str] = None,
    product: Optional[str] = None,
    country: Optional[str] = None,
    refresh: Optional[bool] = False,
):
    """Fans out per-location because upstream /inventory is hard-capped at
    2000 rows. When `location` is given, still go through the helper so
    that Warehouse Finished Goods gets chunked & country is lowercased.
    `locations` (CSV) scopes the fan-out to a subset of POS locations."""
    if refresh:
        _inv_cache["ts"] = 0
        _inv_cache["key"] = None
    locs = _split_csv(locations)
    return await fetch_all_inventory(
        country=country, location=location, product=product,
        locations=locs if locs else None,
    )


@api_router.post("/admin/cache-clear")
async def admin_cache_clear():
    """Clear all server-side caches so the next request re-fetches
    from upstream Vivo BI. Non-authenticated (same trust zone as /api/*).
    """
    _inv_cache["ts"] = 0
    _inv_cache["key"] = None
    _inv_cache["data"] = None
    _churn_full_cache.clear()
    _kpi_stale_cache.clear()
    return {"ok": True, "cleared": ["inventory", "churn_full", "kpi_stale"]}


@api_router.get("/stock-to-sales")
async def get_stock_to_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    locations: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    if len(cs) <= 1:
        rows = await fetch("/stock-to-sales", {**base, "country": cs[0] if cs else None})
    else:
        tasks = [fetch("/stock-to-sales", {**base, "country": c}) for c in cs]
        results = await asyncio.gather(*tasks)
        rows = []
        seen = set()
        for g in results:
            for r in g:
                k = (r.get("location"), r.get("country"))
                if k in seen:
                    continue
                seen.add(k)
                rows.append(r)
    locs = _split_csv(locations)
    if locs:
        loc_set = {x.strip() for x in locs}
        rows = [r for r in rows if r.get("location") in loc_set]

    # Enrich each row with a per-location Weeks-of-Cover calculated from the
    # last-4-week sell-through (not the user-selected period).
    #   weeks_of_cover = current_stock ÷ (units_sold_last_28d ÷ 4)
    try:
        from datetime import datetime, timedelta
        woc_to = datetime.utcnow().date()
        woc_from = woc_to - timedelta(days=28)
        sor_base = {"date_from": woc_from.isoformat(), "date_to": woc_to.isoformat()}
        woc_cs = cs or [None]
        sor_results = await asyncio.gather(*[fetch("/stock-to-sales", {**sor_base, "country": c}) for c in woc_cs])
        units_28_by_loc: Dict[str, float] = defaultdict(float)
        for g in sor_results:
            for r in g or []:
                loc = r.get("location")
                if loc:
                    units_28_by_loc[loc] += float(r.get("units_sold") or 0)
        for r in rows:
            u28 = units_28_by_loc.get(r.get("location"), 0)
            weekly = u28 / 4 if u28 else 0
            stock = r.get("current_stock") or 0
            r["weeks_of_cover"] = (stock / weekly) if weekly else None
            r["units_sold_28d"] = u28
    except Exception:
        for r in rows:
            r.setdefault("weeks_of_cover", None)

    return rows


@api_router.get("/customers")
async def get_customers(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        data = await fetch("/customers", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
    else:
        results = await multi_fetch("/customers", base, cs, chs)
        total = {
            "total_customers": 0, "new_customers": 0, "repeat_customers": 0,
            "returning_customers": 0, "churned_customers": 0,
            "_sum_spend": 0.0, "_sum_orders": 0.0, "_n": 0,
        }
        for r in results:
            for k in ("total_customers", "new_customers", "repeat_customers", "returning_customers", "churned_customers"):
                total[k] += r.get(k) or 0
            total["_sum_spend"] += (r.get("avg_customer_spend") or 0) * (r.get("total_customers") or 0)
            total["_sum_orders"] += (r.get("avg_orders_per_customer") or 0) * (r.get("total_customers") or 0)
            total["_n"] += r.get("total_customers") or 0
        total["avg_customer_spend"] = (total["_sum_spend"] / total["_n"]) if total["_n"] else 0
        total["avg_orders_per_customer"] = (total["_sum_orders"] / total["_n"]) if total["_n"] else 0
        for k in ("_sum_spend", "_sum_orders", "_n"):
            total.pop(k)
        data = total

    # Churn rate — FINAL business definition (user-confirmed):
    #   A churned customer is one whose LAST purchase was more than 90 days
    #   ago from TODAY. "Period-churned" means: their LAST purchase date
    #   falls INSIDE the selected date range — i.e. they bought in the
    #   period and have not returned in 90+ days.
    #
    #   churn_rate = churned_in_period ÷ total_customers_in_period × 100
    #
    # For an IN-PROGRESS period (range ends today), this number is naturally
    # near-zero because customers can't have bought in the period AND also
    # be 90d+ inactive. For historical ranges (e.g. Jan 2026 viewed in Apr
    # 2026), the rate is meaningful.
    if data:
        active = data.get("total_customers") or 0
        churn_window_days = 90
        churn_source = "upstream_90d"
        churned_in_period = 0
        try:
            # Upstream caps at ~100k rows. Full list is needed so we can
            # slice by last_purchase_date within [date_from, date_to].
            # Cached in-memory for 30 min — full fetch is ~30s on cold.
            cached = _churn_full_cache.get(churn_window_days)
            if cached and (time.time() - cached[0]) < _CHURN_FULL_TTL:
                churned_list = cached[1]
                churn_source = "upstream_90d_cached"
            else:
                churned_list = await _safe_fetch("/churned-customers", {"days": churn_window_days, "limit": 100000})
                if isinstance(churned_list, list) and churned_list:
                    _churn_full_cache[churn_window_days] = (time.time(), churned_list)
            if isinstance(churned_list, list) and date_from and date_to:
                for c in churned_list:
                    lp = c.get("last_purchase_date") or ""
                    if date_from <= lp <= date_to:
                        churned_in_period += 1
            elif isinstance(churned_list, list):
                # No period filter → report the full list (all-time 90d churned).
                churned_in_period = len(churned_list)
        except Exception:
            churn_source = "upstream_down"

        # All-time cumulative churn (fallback / reference).
        churned_all = data.get("churned_customers") or 0
        denom_all = active + churned_all
        data["churn_rate_cumulative"] = round((churned_all / denom_all * 100), 2) if denom_all else 0

        if churned_in_period == 0 and (not date_from or not date_to):
            # No period filter → fall back to all-time count.
            churned_in_period = churned_all
            churn_source = "cumulative_fallback"

        data["churned_customers"] = churned_in_period  # override with period-scoped count
        data["churned_last_90d"] = churned_in_period   # legacy field name kept for UI compat
        data["churn_window_days"] = churn_window_days
        data["churn_source"] = churn_source
        data["churn_rate"] = round((churned_in_period / active * 100), 2) if active else 0
    return data


@api_router.get("/customer-trend")
async def get_customer_trend(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    if len(cs) <= 1:
        return await fetch("/customer-trend", {**base, "country": cs[0] if cs else None})
    tasks = [fetch("/customer-trend", {**base, "country": c}) for c in cs]
    results = await asyncio.gather(*tasks)
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for r in g:
            day = r.get("day")
            if day not in merged:
                merged[day] = {"day": day, "total_customers": 0, "new_customers": 0, "returning_customers": 0}
            for k in ("total_customers", "new_customers", "returning_customers"):
                merged[day][k] += r.get(k) or 0
    out = list(merged.values())
    out.sort(key=lambda r: r["day"])
    return out


# -------------------- New customer endpoints (proxies with graceful upstream 500 fallback) --------------------
async def _safe_fetch(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """Wrap fetch() so an upstream 5xx becomes an empty list rather than a
    propagated 502. Lets the frontend show 'no data' instead of crashing."""
    try:
        return await fetch(path, params or {})
    except HTTPException as e:
        if e.status_code >= 500:
            logger.warning("Upstream %s failed: %s — returning []", path, e.detail)
            return []
        raise


@api_router.get("/top-customers")
async def get_top_customers(
    request: Request,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = 20,
    user=Depends(get_current_user),
):
    rows = await _safe_fetch("/top-customers", {
        "date_from": date_from, "date_to": date_to,
        "country": country, "channel": channel, "limit": limit,
    })
    return await mask_and_audit(rows or [], user=user, endpoint="/top-customers", request_ip=_client_ip(request))


@api_router.get("/customer-search")
async def customer_search(request: Request, q: str, user=Depends(get_current_user)):
    if not q or not q.strip():
        return []
    rows = await _safe_fetch("/customer-search", {"q": q.strip()})
    return await mask_and_audit(rows or [], user=user, endpoint="/customer-search", request_ip=_client_ip(request))


@api_router.get("/customer-products")
async def customer_products(request: Request, customer_id: str, user=Depends(get_current_user)):
    rows = await _safe_fetch("/customer-products", {"customer_id": customer_id})
    # Per-purchase data; mask_and_audit is still safe (no-op if no PII fields).
    return await mask_and_audit(rows or [], user=user, endpoint="/customer-products", request_ip=_client_ip(request))


@api_router.get("/churned-customers")
async def churned_customers(request: Request, days: int = 90, limit: int = 20, user=Depends(get_current_user)):
    rows = await _safe_fetch("/churned-customers", {"days": days, "limit": limit})
    return await mask_and_audit(rows or [], user=user, endpoint="/churned-customers", request_ip=_client_ip(request))


@api_router.get("/orders")
async def get_orders(
    request: Request,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    sale_kind: Optional[str] = None,
    limit: int = 5000,
    user=Depends(get_current_user),
):
    """Order & line-level export proxy. Supports multi-value country/channel
    (CSV) by fanning out and concatenating results. `sale_kind` filters to
    'order' / 'return' / None (all)."""
    base = {"date_from": date_from, "date_to": date_to, "limit": limit}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        rows = await _safe_fetch("/orders", {
            **base,
            "country": cs[0] if cs else None,
            "channel": chs[0] if chs else None,
        }) or []
    else:
        tasks = []
        for c in (cs or [None]):
            for ch in (chs or [None]):
                params = {**base}
                if c:
                    params["country"] = c
                if ch:
                    params["channel"] = ch
                tasks.append(_safe_fetch("/orders", params))
        results = await asyncio.gather(*tasks)
        rows = []
        for r in results:
            if r:
                rows.extend(r)
    if sale_kind:
        rows = [r for r in rows if r.get("sale_kind") == sale_kind]
    return await mask_and_audit(rows, user=user, endpoint="/orders", request_ip=_client_ip(request))


@api_router.get("/customer-frequency")
async def customer_frequency(
    request: Request,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    rows = await _safe_fetch("/customer-frequency", {
        "date_from": date_from, "date_to": date_to,
    })
    # Aggregate buckets have no row-level PII; pass-through via mask_rows
    # (no-op when fields are absent).
    return mask_rows(rows or [], getattr(user, "role", None))


@api_router.get("/customers-by-location")
async def customers_by_location(
    request: Request,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    rows = await _safe_fetch("/customers-by-location", {
        "date_from": date_from, "date_to": date_to,
    })
    chs = _split_csv(channel)
    if chs:
        ch_set = {c.strip() for c in chs}
        rows = [r for r in (rows or []) if r.get("pos_location") in ch_set]
    # Aggregate counts per POS — no row-level PII, mask is a no-op.
    return mask_rows(rows or [], getattr(user, "role", None))


@api_router.get("/new-customer-products")
async def new_customer_products(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 20,
):
    return await _safe_fetch("/new-customer-products", {
        "date_from": date_from, "date_to": date_to, "limit": limit,
    })


# -------------------- Data freshness --------------------
@api_router.get("/data-freshness")
async def data_freshness():
    """Publishes an SLA-oriented snapshot of when upstream data was last
    refreshed. Currently we don't have a direct ETA feed from Odoo / BigQuery
    so we use the most-recent `day` present in /daily-trend as a proxy for
    last-extraction, and advertise the team's publicly-known ETL cadence."""
    last_day = None
    try:
        rows = await _safe_fetch("/daily-trend", {
            "date_from": (datetime.utcnow() - timedelta(days=7)).date().isoformat(),
            "date_to": datetime.utcnow().date().isoformat(),
        })
        if rows:
            last_day = max((r.get("day") for r in rows if r.get("day")), default=None)
    except Exception:
        pass

    # Next scheduled run: every 6 hours at :00 UTC (matches upstream ETL).
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    next_run = now.replace(hour=(now.hour // 6 + 1) * 6 % 24)
    if next_run <= now:
        next_run = next_run + timedelta(days=1)

    return {
        "last_sale_date": last_day,
        "last_odoo_extract_at": datetime.utcnow().isoformat() + "Z",
        "last_bigquery_load_at": datetime.utcnow().isoformat() + "Z",
        "next_scheduled_run_at": next_run.isoformat() + "Z",
        "sla_hours": 6,
        "etl_cadence": "Every 6 hours",
    }



# -------------------- Sales projection --------------------
@api_router.get("/analytics/sales-projection")
async def analytics_sales_projection(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Project total sales for the selected window based on current run-rate.
    Uses daily run-rate × total days in the window."""
    import datetime as _dt
    try:
        df = _dt.date.fromisoformat(date_from)
        dt = _dt.date.fromisoformat(date_to)
    except Exception:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
    total_days = (dt - df).days + 1
    if total_days <= 0:
        return {"projected_sales": 0, "actual_sales": 0, "days_elapsed": 0, "total_days": 0, "daily_run_rate": 0}

    today = _dt.date.today()
    end_observed = min(dt, today)
    days_elapsed = max(0, (end_observed - df).days + 1)
    if days_elapsed <= 0:
        return {"projected_sales": 0, "actual_sales": 0, "days_elapsed": 0, "total_days": total_days, "daily_run_rate": 0}

    kpis = await get_kpis(
        date_from=df.isoformat(), date_to=end_observed.isoformat(),
        country=country, channel=channel,
    )
    actual = (kpis or {}).get("total_sales") or 0
    daily_run_rate = actual / days_elapsed if days_elapsed else 0
    projected = daily_run_rate * total_days
    return {
        "actual_sales": actual,
        "days_elapsed": days_elapsed,
        "total_days": total_days,
        "daily_run_rate": daily_run_rate,
        "projected_sales": projected,
        "completion_pct": (days_elapsed / total_days * 100) if total_days else 0,
    }


# -------------------- Inter-Branch Transfer (IBT) suggestions --------------------
WAREHOUSE_NAMES = {
    "Warehouse Finished Goods", "Warehouse",
    "Vivo Warehouse", "Shop Zetu Warehouse",
}


@api_router.get("/analytics/ibt-suggestions")
async def analytics_ibt_suggestions(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    min_move: int = 2,
    limit: int = 100,
):
    """Inter-Branch Transfer recommendations.

    Algorithm (simplified, practical):
      1. Fetch full inventory (all stores).
      2. For each physical store (excluding warehouses), fetch top-skus for
         the selected window.
      3. For every style that appears in at least TWO stores' inventory:
          • Compute velocity per store = (units sold in window / days).
          • If store A has stock ≥ min_move AND velocity ≤ 20% of group-avg,
            AND store B has velocity ≥ 150% of group-avg AND stock < 5,
            suggest moving min(A.stock - buffer, B.gap_to_cover) units.
      4. Sort by estimated uplift desc, return top N.
    """
    import datetime as _dt
    if not date_from or not date_to:
        dt = _dt.date.today()
        df = dt - _dt.timedelta(days=28)
        date_from, date_to = df.isoformat(), dt.isoformat()

    try:
        total_days = max(1, (_dt.date.fromisoformat(date_to) - _dt.date.fromisoformat(date_from)).days + 1)
    except Exception:
        total_days = 28

    # 1) All inventory (cached 60s)
    inv = await fetch_all_inventory(country=country)
    if not inv:
        return []

    # physical stores only
    all_locations = sorted({
        r.get("location_name") for r in inv
        if r.get("location_name") and r.get("location_name") not in WAREHOUSE_NAMES
    })

    # 2) Sales per store (top-skus per channel)
    async def _per_store_top(ch: str):
        try:
            rows = await _safe_fetch("/top-skus", {
                "date_from": date_from, "date_to": date_to,
                "channel": ch, "limit": 200,
            })
            return ch, rows or []
        except Exception:
            return ch, []

    store_sales_results = await asyncio.gather(*[_per_store_top(ch) for ch in all_locations])

    # Build a map: (style_name, store) -> units_sold, avg_price
    sales_map: Dict[tuple, Dict[str, float]] = {}
    for store, rows in store_sales_results:
        for r in rows:
            style = r.get("style_name")
            if not style:
                continue
            sales_map[(style, store)] = {
                "units_sold": r.get("units_sold") or 0,
                "avg_price": r.get("avg_price") or 0,
            }

    # Build per-style -> per-store stock (from inventory at style level)
    stock_map: Dict[tuple, Dict[str, Any]] = {}
    for r in inv:
        style = r.get("style_name") or r.get("product_name")
        loc = r.get("location_name")
        if not style or not loc or loc in WAREHOUSE_NAMES:
            continue
        key = (style, loc)
        if key not in stock_map:
            stock_map[key] = {
                "available": 0, "brand": r.get("brand"),
                "product_type": r.get("product_type"),
            }
        stock_map[key]["available"] += float(r.get("available") or 0)

    # Index by style
    style_locs: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for (style, loc), v in stock_map.items():
        style_locs[style][loc] = {
            "available": v["available"],
            "brand": v["brand"],
            "product_type": v["product_type"],
            "units_sold": (sales_map.get((style, loc)) or {}).get("units_sold", 0),
            "avg_price": (sales_map.get((style, loc)) or {}).get("avg_price", 0),
        }

    suggestions: List[Dict[str, Any]] = []
    for style, per_store in style_locs.items():
        if len(per_store) < 2:
            continue
        total_units = sum(s["units_sold"] for s in per_store.values())
        avg_units = total_units / len(per_store)
        if avg_units <= 0:
            continue

        # Low-velocity candidates (FROM)
        lows = [(loc, s) for loc, s in per_store.items()
                if s["available"] >= min_move and s["units_sold"] <= avg_units * 0.2]
        # High-demand candidates (TO)
        highs = [(loc, s) for loc, s in per_store.items()
                 if s["units_sold"] >= avg_units * 1.5 and s["available"] < 5]

        for from_loc, from_s in lows:
            for to_loc, to_s in highs:
                if from_loc == to_loc:
                    continue
                # Estimate target cover: ~2 weeks at current velocity.
                daily = to_s["units_sold"] / total_days
                target = max(min_move, int(daily * 14))
                gap = max(0, target - int(to_s["available"]))
                movable = int(min(from_s["available"] - 2, gap))
                if movable < min_move:
                    continue
                avg_price = to_s["avg_price"] or from_s["avg_price"] or 0
                uplift = movable * avg_price
                suggestions.append({
                    "style_name": style,
                    "brand": from_s["brand"],
                    "subcategory": from_s["product_type"],
                    "from_store": from_loc,
                    "to_store": to_loc,
                    "from_available": int(from_s["available"]),
                    "from_units_sold": int(from_s["units_sold"]),
                    "to_available": int(to_s["available"]),
                    "to_units_sold": int(to_s["units_sold"]),
                    "units_to_move": movable,
                    "estimated_uplift": round(uplift),
                    "avg_price": avg_price,
                    "reason": (
                        f"Low sell-through at {from_loc} "
                        f"({int(from_s['units_sold'])} units sold · {int(from_s['available'])} in stock) · "
                        f"strong demand at {to_loc} "
                        f"({int(to_s['units_sold'])} sold · {int(to_s['available'])} in stock)"
                    ),
                })

    suggestions.sort(key=lambda x: x["estimated_uplift"], reverse=True)
    return suggestions[: int(limit)]


# -------------------- Customer cross-shop (which stores share customers) --------------------
@api_router.get("/analytics/customer-crosswalk")
async def analytics_customer_crosswalk(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    top: int = 15,
):
    """Rough approximation of store cross-shop. Upstream does not expose
    per-customer purchase location, so we approximate by overlap in each
    store's top-20 customer list.

    Returns: [{store_a, store_b, shared_customers, pct_overlap}]
    """
    rows = await _safe_fetch("/customers-by-location", {
        "date_from": date_from, "date_to": date_to,
    })
    if not rows:
        return []

    stores = [r.get("pos_location") for r in rows if r.get("pos_location")]
    stores = [s for s in stores if s and s not in WAREHOUSE_NAMES][:20]

    async def _top_for(store: str):
        try:
            data = await _safe_fetch("/top-customers", {
                "date_from": date_from, "date_to": date_to,
                "channel": store, "limit": 50,
            })
            ids = {c.get("customer_id") for c in (data or []) if c.get("customer_id")}
            return store, ids
        except Exception:
            return store, set()

    results = await asyncio.gather(*[_top_for(s) for s in stores])
    by_store: Dict[str, set] = {s: ids for s, ids in results}

    out: List[Dict[str, Any]] = []
    names = list(by_store.keys())
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            sa, sb = by_store[a], by_store[b]
            if not sa or not sb:
                continue
            shared = sa & sb
            if not shared:
                continue
            denom = min(len(sa), len(sb)) or 1
            out.append({
                "store_a": a, "store_b": b,
                "shared_customers": len(shared),
                "pct_overlap": round(len(shared) / denom * 100, 2),
            })
    out.sort(key=lambda x: x["shared_customers"], reverse=True)
    return out[: int(top)]


@api_router.get("/footfall")
@api_router.get("/footfall")
async def get_footfall(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    channel: Optional[str] = None,
):
    base = {"date_from": date_from, "date_to": date_to}
    chs = _split_csv(channel)
    if len(chs) <= 1:
        return await fetch("/footfall", {**base, "channel": chs[0] if chs else None})
    tasks = [fetch("/footfall", {**base, "channel": ch}) for ch in chs]
    results = await asyncio.gather(*tasks)
    out = []
    seen = set()
    for g in results:
        for r in g:
            k = r.get("location")
            if k in seen:
                continue
            seen.add(k)
            out.append(r)
    return out


@api_router.get("/subcategory-sales")
async def get_subcategory_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Upstream now returns one clean row per subcategory (no brand split),
    so we fan out per country/channel and merge by subcategory only."""
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        return await fetch("/subcategory-sales", {
            **base, "country": cs[0] if cs else None, "channel": chs[0] if chs else None,
        })
    results = await multi_fetch("/subcategory-sales", base, cs, chs)
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for r in g:
            key = r.get("subcategory")
            if not key:
                continue
            if key not in merged:
                merged[key] = {**r}
            else:
                for f in ("units_sold", "total_sales", "gross_sales", "orders"):
                    merged[key][f] = (merged[key].get(f) or 0) + (r.get(f) or 0)
    return sorted(merged.values(), key=lambda r: r.get("total_sales") or 0, reverse=True)


@api_router.get("/subcategory-stock-sales")
async def get_subcategory_stock_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    return await fetch("/subcategory-stock-sales", {
        "date_from": date_from, "date_to": date_to,
        "country": country if country and "," not in country else country,
        "channel": channel,
    })


# -------------------- Inventory helpers --------------------
WAREHOUSE_KEYS = (
    "warehouse", "wholesale", "holding", "sale stock", "bundling",
    "defect", "shopping bags", "buying and merchandise", "mockup",
    "online orders location",
)

# Simple in-memory cache for inventory fan-out (60s TTL).
_inv_cache: Dict[str, Any] = {"ts": 0, "key": None, "data": None}
_INV_TTL = 60.0


def is_warehouse_location(name: Optional[str]) -> bool:
    if not name:
        return False
    n = name.lower()
    return any(k in n for k in WAREHOUSE_KEYS)


# Locations that should be EXCLUDED from inventory analysis entirely
# (non-retail, non-physical, non-real-stock locations).
INVENTORY_EXCLUDED_LOCATIONS = {
    "bundling", "buying and merchandise", "defectss location",
    "shopping bags location", "mockup store", "holding location",
    "the oasis mall holding location", "online orders location",
    "third-party app", "sale stock location", "a vivo warehouse location",
    "vivo wholesale location",
}

# Brands to exclude from inventory analysis (per user request)
INVENTORY_EXCLUDED_BRANDS = {"third party brands"}


def is_excluded_location(name: Optional[str]) -> bool:
    if not name:
        return False
    return name.strip().lower() in INVENTORY_EXCLUDED_LOCATIONS


def is_excluded_brand(brand: Optional[str]) -> bool:
    if not brand:
        return False
    return brand.strip().lower() in INVENTORY_EXCLUDED_BRANDS


EXCLUDED_PRODUCT_TOKENS = ("shopping bag", "gift voucher", "gift card")
EXCLUDED_SKU_PREFIXES = ("VB00",)


def is_excluded_product(row: Dict[str, Any]) -> bool:
    name = (row.get("product_name") or "").lower()
    if any(tok in name for tok in EXCLUDED_PRODUCT_TOKENS):
        return True
    sku = row.get("sku") or ""
    return any(sku.startswith(p) for p in EXCLUDED_SKU_PREFIXES)


# Locations not in /locations channel list but that hold stock in /inventory.
# Upstream /inventory for this location is hard-capped at 2000 rows, so we
# chunk by product-prefix letter to try to get the full 8k+ SKU set.
EXTRA_INVENTORY_LOCATIONS = [
    {"channel": "Warehouse Finished Goods", "country": "Kenya"},
]
# Chunk keys used to bypass upstream /inventory 2000-row cap for the large
# Warehouse Finished Goods location (8k+ SKUs). A-Z + 0-9 covers most; the
# 2-letter prefixes for the top brands (V, S, A, T, Z with vowels) pick up
# the remaining SKUs that hit the 2000-row cap on single-letter queries.
WAREHOUSE_CHUNK_KEYS = (
    list("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    + [f"V{c}" for c in "aeiou"]
    + [f"S{c}" for c in "aeiou"]
    + [f"A{c}" for c in "aeiou"]
    + [f"T{c}" for c in "aeiou"]
    + [f"Z{c}" for c in "aeiou"]
)


async def fetch_all_inventory(
    country: Optional[str] = None,
    location: Optional[str] = None,
    product: Optional[str] = None,
    locations: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Upstream /inventory hard-caps at 2000 rows. To get the full picture
    across all 51 locations we fan-out per-location and merge. For the
    Warehouse Finished Goods location (8k+ SKUs) we additionally chunk by
    product-prefix letter and dedupe. Cached 60s.

    When `locations` (list) is given we fan-out only across those. `location`
    (singular) is kept for backward compat and takes precedence when set.
    """
    if location:
        if location == "Warehouse Finished Goods":
            rows = await _fetch_warehouse_chunked(country=country, product=product)
        else:
            rows = await fetch("/inventory", {
                "country": (country or "").lower() or None,
                "location": location, "product": product,
            }) or []
        # Same filtering as fan-out path
        return [
            r for r in rows
            if (r.get("product_name") or r.get("sku"))
            and not is_excluded_brand(r.get("brand"))
            and not is_excluded_product(r)
        ]

    # Scoped fan-out across a subset of locations.
    if locations:
        async def _one_loc(ch: str):
            try:
                if ch == "Warehouse Finished Goods":
                    rows = await _fetch_warehouse_chunked(country=country, product=product)
                else:
                    rows = await fetch("/inventory", {
                        "country": (country or "").lower() or None,
                        "location": ch, "product": product,
                    }) or []
                return [
                    r for r in rows
                    if (r.get("product_name") or r.get("sku"))
                    and not is_excluded_brand(r.get("brand"))
                    and not is_excluded_product(r)
                ]
            except HTTPException:
                return []
        results = await asyncio.gather(*[_one_loc(ch) for ch in locations])
        merged: List[Dict[str, Any]] = []
        for r in results:
            merged.extend(r or [])
        return merged

    cache_key = f"{country or ''}|{product or ''}"
    if _inv_cache.get("key") == cache_key and (time.time() - _inv_cache.get("ts", 0)) < _INV_TTL:
        return _inv_cache["data"]

    locs_raw = await fetch("/locations") or []
    # Merge in extra known-but-unlisted locations (e.g. Warehouse Finished Goods).
    locs_raw = list(locs_raw) + [e for e in EXTRA_INVENTORY_LOCATIONS if not any(loc.get("channel") == e["channel"] for loc in locs_raw)]
    # Filter out non-retail / non-real-stock locations so they don't pollute
    # the aggregate.
    locs_raw = [loc for loc in locs_raw if not is_excluded_location(loc.get("channel"))]
    cs = _split_csv(country)
    if cs:
        # Case-insensitive match — frontend normalizes to lowercase ("kenya")
        # but upstream /locations returns title-case ("Kenya"). Without this
        # normalization the intersection would be empty and the whole
        # inventory page would render zero.
        cs_lower = {c.lower() for c in cs}
        locs_raw = [loc for loc in locs_raw if (loc.get("country") or "").lower() in cs_lower]

    async def _one(loc):
        try:
            if loc.get("channel") == "Warehouse Finished Goods":
                rows = await _fetch_warehouse_chunked(country=loc.get("country"), product=product)
            else:
                rows = await fetch("/inventory", {
                    "country": (loc.get("country") or "").lower() or None,
                    "location": loc.get("channel"),
                    "product": product,
                }) or []
            # Filter out:
            # 1. Excluded brands (e.g. Third Party Brands).
            # 2. Upstream phantom/aggregate rows that have no product_name AND
            #    no SKU — these carry inflated unit counts and pollute totals.
            # 3. Shopping bags / gift vouchers / gift cards / VB00 SKUs.
            return [
                r for r in rows
                if (r.get("product_name") or r.get("sku"))
                and not is_excluded_brand(r.get("brand"))
                and not is_excluded_product(r)
            ]
        except HTTPException:
            return []

    results = await asyncio.gather(*[_one(loc) for loc in locs_raw], return_exceptions=False)
    merged: List[Dict[str, Any]] = []
    for r in results:
        if r:
            merged.extend(r)

    _inv_cache["ts"] = time.time()
    _inv_cache["key"] = cache_key
    _inv_cache["data"] = merged
    return merged


async def _fetch_warehouse_chunked(
    country: Optional[str] = None,
    product: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Warehouse Finished Goods has 8k+ SKUs but upstream caps at 2000 rows.
    Chunk by product-prefix letter and dedupe by (sku, size)."""
    c = (country or "Kenya").lower()
    # If caller passed an explicit product filter, just do a single call — no chunking.
    if product:
        return await fetch("/inventory", {
            "country": c, "location": "Warehouse Finished Goods", "product": product,
        }) or []

    async def _chunk(letter):
        try:
            return await fetch("/inventory", {
                "country": c, "location": "Warehouse Finished Goods", "product": letter,
            })
        except HTTPException:
            return []

    results = await asyncio.gather(*[_chunk(L) for L in WAREHOUSE_CHUNK_KEYS], return_exceptions=False)
    seen: Dict[str, Dict[str, Any]] = {}
    for group in results:
        for r in group or []:
            key = f"{r.get('sku') or ''}|{r.get('barcode') or ''}|{r.get('size') or ''}"
            if key == "||" and not r.get("product_name"):
                # Aggregate null-row — keep only once
                if "_null_agg" in seen:
                    continue
                seen["_null_agg"] = r
            elif key not in seen:
                seen[key] = r
    return list(seen.values())


# -------------------- Aggregation helpers --------------------
@api_router.get("/analytics/active-pos")
async def analytics_active_pos(
    days: int = 30,
):
    """Return list of active physical store locations — channels that:
    - aren't warehouse/holding/online/third-party etc.
    - had at least 1 sale in the last `days` days."""
    from datetime import datetime, timedelta
    dt = datetime.utcnow().date()
    df = dt - timedelta(days=days)
    sales = await fetch("/sales-summary", {"date_from": df.isoformat(), "date_to": dt.isoformat()}) or []
    active_channels = {r.get("channel") for r in sales if (r.get("total_sales") or 0) > 0}
    locs = await fetch("/locations") or []
    out = []
    for loc in locs:
        ch = loc.get("channel")
        if not ch:
            continue
        if is_excluded_location(ch):
            continue
        low = ch.lower()
        if "online" in low or "third-party" in low:
            continue
        if ch in active_channels:
            out.append(loc)
    return out


@api_router.get("/analytics/stock-to-sales-by-subcat")
async def analytics_sts_by_subcat(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
    include_warehouse: bool = False,
):
    """Derived view of /subcategory-stock-sales with a variance column
    (% of sales − % of stock). One clean row per subcategory.

    When `locations` (CSV) is given, current_stock is recomputed locally
    from the location-scoped inventory so the stock side matches the
    POS selection (upstream's `channel` param only filters the sales side).
    If no `channel` is explicitly passed but `locations` is, we forward
    `locations` as `channel` to the upstream `/subcategory-stock-sales`
    call so both SALES and STOCK scope to the same POS.

    When `include_warehouse=True` AND a POS scope is active, warehouse /
    holding inventory (Warehouse Finished Goods, Wholesale, etc.) is
    ADDED to the POS stock so users see total allocable inventory, not
    just shop-floor. When no POS is set, the flag is a no-op (upstream
    already returns group-wide stock)."""
    effective_channel = channel or locations
    rows = await get_subcategory_stock_sales(
        date_from=date_from, date_to=date_to, country=country, channel=effective_channel,
    )
    # Pull /subcategory-sales in parallel for `orders` (needed by callers to
    # compute ABV / MSI at subcategory level). Keyed by subcategory.
    sales_rows = await get_subcategory_sales(
        date_from=date_from, date_to=date_to, country=country, channel=effective_channel,
    )
    orders_by_subcat: Dict[str, int] = {
        (r.get("subcategory") or ""): int(r.get("orders") or 0)
        for r in (sales_rows or [])
    }
    locs = _split_csv(locations) or _split_csv(channel)
    stock_by_subcat: Optional[Dict[str, float]] = None
    if locs:
        inv = await fetch_all_inventory(country=country, locations=locs)
        stock_by_subcat = defaultdict(float)
        for r in inv or []:
            pt = r.get("product_type")
            if not pt:
                continue
            stock_by_subcat[pt] += float(r.get("available") or 0)
        if include_warehouse:
            # Fan-out inventory for all locations in country scope and add the
            # rows from warehouse / holding locations on top.
            all_inv = await fetch_all_inventory(country=country)
            for r in all_inv or []:
                if not is_warehouse_location(r.get("location_name")):
                    continue
                pt = r.get("product_type")
                if not pt:
                    continue
                stock_by_subcat[pt] += float(r.get("available") or 0)
        total_stock_local = sum(stock_by_subcat.values()) or 0

    out = []
    for r in rows or []:
        pct_sold = r.get("pct_of_total_sold") or 0
        if stock_by_subcat is not None:
            cs = stock_by_subcat.get(r.get("subcategory"), 0)
            pct_stock = (cs / total_stock_local * 100) if total_stock_local else 0
            current_stock = cs
        else:
            pct_stock = r.get("pct_of_total_stock") or 0
            current_stock = r.get("current_stock") or 0
        out.append({
            "subcategory": r.get("subcategory"),
            "units_sold": r.get("units_sold") or 0,
            "current_stock": current_stock,
            "pct_of_total_sold": pct_sold,
            "pct_of_total_stock": pct_stock,
            "variance": pct_sold - pct_stock,
            "sor_percent": r.get("sor_percent") or 0,
            "total_sales": r.get("total_sales") or 0,
            "orders": orders_by_subcat.get(r.get("subcategory") or "", 0),
        })
    out.sort(key=lambda x: x["units_sold"], reverse=True)
    return out


@api_router.get("/analytics/stock-to-sales-by-category")
async def analytics_sts_by_category(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
    include_warehouse: bool = False,
):
    """Roll subcategory-stock-sales up to CATEGORY level using subcategory
    name prefixes. "Category" is approximated as the first word of the
    subcategory (e.g. "Knee Length Dresses" → "Dresses"). Falls back to
    the full subcategory if no mapping exists. When `locations` is given,
    stock is recomputed from location-scoped inventory.
    If no `channel` is explicitly passed but `locations` is, we forward
    `locations` as `channel` to the upstream sales call so both SALES
    and STOCK scope to the same POS.
    `include_warehouse=True` ADDS warehouse / holding stock on top of the
    POS stock (see `analytics_sts_by_subcat` for details)."""
    effective_channel = channel or locations
    rows = await get_subcategory_stock_sales(
        date_from=date_from, date_to=date_to, country=country, channel=effective_channel,
    )
    # Parallel pull of /subcategory-sales to enable orders-based metrics
    # (ABV, MSI) at the category level after the subcategory→category roll-up.
    sales_rows = await get_subcategory_sales(
        date_from=date_from, date_to=date_to, country=country, channel=effective_channel,
    )
    orders_by_subcat: Dict[str, int] = {
        (r.get("subcategory") or ""): int(r.get("orders") or 0)
        for r in (sales_rows or [])
    }
    # See note in `analytics_sts_by_subcat` — scope stock side to the same POS
    # whether the client sent `locations` or `channel`.
    locs = _split_csv(locations) or _split_csv(channel)
    inv_rows: List[Dict[str, Any]] = []
    if locs:
        inv_rows = await fetch_all_inventory(country=country, locations=locs) or []
        if include_warehouse:
            all_inv = await fetch_all_inventory(country=country)
            for r in all_inv or []:
                if is_warehouse_location(r.get("location_name")):
                    inv_rows.append(r)

    def category_of(sub: str) -> str:
        if not sub:
            return "—"
        s = sub.lower()
        if "dress" in s:
            return "Dresses"
        if "top" in s:
            return "Tops"
        if "pant" in s or "legging" in s or "shorts" in s or "skorts" in s or "skirt" in s:
            return "Bottoms"
        if "coat" in s or "jacket" in s or "poncho" in s or "sweater" in s or "kimono" in s or "waterfall" in s:
            return "Outerwear"
        if "jumpsuit" in s or "playsuit" in s or "bodysuit" in s:
            return "Sets & Bodysuits"
        if "accessory" in s or "bag" in s or "scarf" in s or "jewel" in s:
            return "Accessories"
        return sub

    # If locations filter is provided, rebuild current_stock per row
    # from local inventory (upstream's channel param only filters sales).
    if locs:
        stock_by_subcat: Dict[str, float] = defaultdict(float)
        for r in inv_rows:
            pt = r.get("product_type")
            if not pt:
                continue
            stock_by_subcat[pt] += float(r.get("available") or 0)
        rows = [
            {**r, "current_stock": stock_by_subcat.get(r.get("subcategory"), 0)}
            for r in rows
        ]

    total_sold = sum(r.get("units_sold") or 0 for r in rows)
    total_stock = sum(r.get("current_stock") or 0 for r in rows)
    total_sales = sum(r.get("total_sales") or 0 for r in rows)

    agg: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        cat = category_of(r.get("subcategory"))
        if cat not in agg:
            agg[cat] = {
                "category": cat, "units_sold": 0, "current_stock": 0,
                "total_sales": 0, "subcategories": 0, "orders": 0,
            }
        agg[cat]["units_sold"] += r.get("units_sold") or 0
        agg[cat]["current_stock"] += r.get("current_stock") or 0
        agg[cat]["total_sales"] += r.get("total_sales") or 0
        agg[cat]["orders"] += orders_by_subcat.get(r.get("subcategory") or "", 0)
        agg[cat]["subcategories"] += 1

    for v in agg.values():
        v["pct_of_total_sold"] = (v["units_sold"] / total_sold * 100) if total_sold else 0
        v["pct_of_total_stock"] = (v["current_stock"] / total_stock * 100) if total_stock else 0
        v["pct_of_total_sales"] = (v["total_sales"] / total_sales * 100) if total_sales else 0
        v["variance"] = v["pct_of_total_sold"] - v["pct_of_total_stock"]
        v["sor_percent"] = (
            (v["units_sold"] / (v["units_sold"] + v["current_stock"]) * 100)
            if (v["units_sold"] + v["current_stock"]) else 0
        )

    return sorted(agg.values(), key=lambda x: x["units_sold"], reverse=True)


@api_router.get("/analytics/weeks-of-cover")
async def analytics_weeks_of_cover(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
):
    """Weeks of Cover per style:
       weeks = current_stock / (units_sold_last_28_days / 4)
    SOR data gives 28-day sell rate when we query the last 28 days.
    When `locations` is provided, current_stock is recomputed from
    location-scoped inventory."""
    from datetime import datetime, timedelta
    dt = datetime.utcnow().date()
    df = dt - timedelta(days=28)

    cs = _split_csv(country)
    chs = _split_csv(channel) or _split_csv(locations)
    base = {"date_from": df.isoformat(), "date_to": dt.isoformat()}

    if len(cs) <= 1 and len(chs) <= 1:
        data = await fetch("/sor", {
            **base,
            "country": cs[0] if cs else None,
            "channel": chs[0] if chs else None,
        })
        rows = data or []
    else:
        results = await multi_fetch("/sor", base, cs, chs)
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for r in g:
                s = r.get("style_name")
                if not s:
                    continue
                if s not in merged:
                    merged[s] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "current_stock"):
                        merged[s][f] = (merged[s].get(f) or 0) + (r.get(f) or 0)
        rows = list(merged.values())

    out = []
    # If locations is provided, recompute current_stock per style from
    # location-scoped inventory.
    local_stock_by_style: Optional[Dict[str, float]] = None
    locs = _split_csv(locations)
    if locs:
        inv = await fetch_all_inventory(country=country, locations=locs) or []
        local_stock_by_style = defaultdict(float)
        for r in inv:
            s = r.get("style_name") or r.get("product_name")
            if s:
                local_stock_by_style[s] += float(r.get("available") or 0)

    for r in rows:
        units = r.get("units_sold") or 0
        style = r.get("style_name")
        if local_stock_by_style is not None:
            stock = local_stock_by_style.get(style, 0)
        else:
            stock = r.get("current_stock") or 0
        weekly = units / 4 if units else 0
        weeks = (stock / weekly) if weekly else None
        out.append({
            "style_name": r.get("style_name"),
            "brand": r.get("brand"),
            "collection": r.get("collection"),
            "subcategory": r.get("product_type"),
            "current_stock": stock,
            "units_sold_28d": units,
            "avg_weekly_sales": weekly,
            "weeks_of_cover": weeks,
            "sor_percent": r.get("sor_percent") or 0,
        })
    return out


# ----- End analytics extensions -----


@api_router.get("/analytics/inventory-summary")
async def analytics_inventory_summary(
    country: Optional[str] = None,
    location: Optional[str] = None,
    locations: Optional[str] = None,
    product: Optional[str] = None,
    refresh: Optional[bool] = False,
):
    if refresh:
        _inv_cache["ts"] = 0
        _inv_cache["key"] = None
    locs = _split_csv(locations)
    inv = await fetch_all_inventory(
        country=country, location=location, product=product,
        locations=locs if locs else None,
    )

    by_country: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"country": "", "units": 0.0, "skus": 0, "locations": set()})
    by_location: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"location": "", "country": "", "units": 0.0, "skus": 0, "is_warehouse": False})
    by_type: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"product_type": "", "units": 0.0})
    # Subcategory split — stores vs warehouse
    by_subcat: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "subcategory": "", "store_units": 0.0, "warehouse_units": 0.0, "total_units": 0.0,
    })
    by_brand: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"brand": "", "units": 0.0, "skus": 0})

    total_units = 0.0
    total_skus = 0
    low_stock = 0
    warehouse_stock = 0.0
    store_stock = 0.0

    for row in inv or []:
        c = (row.get("country") or "Unknown").title()
        loc = row.get("location_name") or "Unknown"
        pt = row.get("product_type")
        if not pt:
            # Skip rows without a subcategory — API is clean now, any null pt
            # is a phantom/pre-release row we don't want in aggregates.
            continue
        avail = float(row.get("available") or 0)
        is_wh = is_warehouse_location(loc)

        by_country[c]["country"] = c
        by_country[c]["units"] += avail
        by_country[c]["skus"] += 1
        by_country[c]["locations"].add(loc)

        key = f"{c}|{loc}"
        by_location[key]["location"] = loc
        by_location[key]["country"] = c
        by_location[key]["units"] += avail
        by_location[key]["skus"] += 1
        by_location[key]["is_warehouse"] = is_wh

        by_type[pt]["product_type"] = pt
        by_type[pt]["units"] += avail

        by_subcat[pt]["subcategory"] = pt
        if is_wh:
            by_subcat[pt]["warehouse_units"] += avail
            warehouse_stock += avail
        else:
            by_subcat[pt]["store_units"] += avail
            store_stock += avail
        by_subcat[pt]["total_units"] += avail

        total_units += avail
        total_skus += 1
        if avail <= 2 and row.get("sku"):
            low_stock += 1

        brand = row.get("brand") or "Unknown"
        by_brand[brand]["brand"] = brand
        by_brand[brand]["units"] += avail
        by_brand[brand]["skus"] += 1

    country_list = [{
        "country": c["country"], "units": c["units"],
        "skus": c["skus"], "locations": len(c["locations"]),
    } for c in by_country.values()]

    subcat_list = sorted(by_subcat.values(), key=lambda x: x["total_units"], reverse=True)

    return {
        "total_units": total_units,
        "store_units": store_stock,
        "warehouse_units": warehouse_stock,
        "total_skus": total_skus,
        "low_stock_skus": low_stock,
        "warehouse_fg_stock": warehouse_stock,  # legacy name
        "markets": len(country_list),
        "by_country": sorted(country_list, key=lambda x: x["units"], reverse=True),
        "by_location": sorted(by_location.values(), key=lambda x: x["units"], reverse=True),
        "by_product_type": sorted(by_type.values(), key=lambda x: x["units"], reverse=True),
        "by_subcategory_split": subcat_list,
        "by_brand": sorted(by_brand.values(), key=lambda x: x["units"], reverse=True),
    }


@api_router.get("/analytics/churn")
async def analytics_churn(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Churn = customers who purchased in the selected period but have NOT
    returned in the last 3 months OF THE PERIOD (i.e. last 90 days of
    [date_from, date_to]).

    Uses set math on upstream /customers aggregates:
       churned = customers_full_period − customers_last_90d_of_period

    If period length < 90 days, churn is not meaningful → returns null.
    """
    from datetime import datetime, timedelta

    if not date_from or not date_to:
        raise HTTPException(status_code=400, detail="date_from and date_to required")
    try:
        df = datetime.fromisoformat(date_from)
        dt = datetime.fromisoformat(date_to)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid date format")
    period_days = (dt - df).days + 1
    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def count_customers(df_s: str, dt_s: str) -> int:
        """Sum unique-per-country customers across countries/channels.
        Note: cross-country sum slightly overcounts customers who shop in
        multiple markets, but upstream gives no cross-market de-dupe."""
        base = {"date_from": df_s, "date_to": dt_s}
        if len(cs) <= 1 and len(chs) <= 1:
            data = await fetch("/customers", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            })
            return int(data.get("total_customers") or 0)
        results = await multi_fetch("/customers", base, cs, chs)
        return sum(int((r or {}).get("total_customers") or 0) for r in results)

    # Full period customers (always needed)
    full_count = await count_customers(date_from, date_to)

    if period_days < 90:
        return {
            "period_days": period_days,
            "total_customers": full_count,
            "recent_customers": None,
            "churned_customers": None,
            "churn_rate": None,
            "applicable": False,
            "reason": "Selected period shorter than 3 months — churn is not meaningful.",
        }

    recent_from = (dt - timedelta(days=89)).date().isoformat()
    recent_count = await count_customers(recent_from, date_to)

    churned = max(0, full_count - recent_count)
    rate = (churned / full_count * 100) if full_count else 0

    return {
        "period_days": period_days,
        "total_customers": full_count,
        "recent_customers": recent_count,
        "recent_from": recent_from,
        "recent_to": date_to,
        "churned_customers": churned,
        "churn_rate": rate,
        "applicable": True,
    }


@api_router.get("/analytics/new-styles")
async def analytics_new_styles(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    brand: Optional[str] = None,
):
    """New styles = style whose first-ever sale is within the last 90 days
    (relative to date_to). Returns performance across the *selected* period
    plus total lifetime (since first sale) figures.
    """
    from datetime import datetime, timedelta

    try:
        ref = datetime.fromisoformat(date_to) if date_to else datetime.utcnow()
    except Exception:
        ref = datetime.utcnow()
    cutoff = ref - timedelta(days=90)
    cutoff_iso = cutoff.date().isoformat()
    pre_cutoff_iso = (cutoff - timedelta(days=1)).date().isoformat()
    to_iso = ref.date().isoformat()

    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def styles_call(df: Optional[str], dt: Optional[str]) -> List[Dict[str, Any]]:
        """List all unique style_names that had any sales in [df, dt]. Uses /top-skus
        with a high limit to bypass the /sor 200-row cap."""
        base = {"date_from": df, "date_to": dt, "limit": 10000}
        if brand:
            base["product"] = brand
        if len(cs) <= 1 and len(chs) <= 1:
            data = await fetch("/top-skus", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            })
            return data or []
        results = await multi_fetch("/top-skus", base, cs, chs)
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for row in g:
                s = row.get("style_name")
                if not s:
                    continue
                if s not in merged:
                    merged[s] = {**row}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales"):
                        merged[s][f] = (merged[s].get(f) or 0) + (row.get(f) or 0)
        return list(merged.values())

    async def sor_call(df: Optional[str], dt: Optional[str]) -> List[Dict[str, Any]]:
        """SOR gives style + current_stock + sor_percent (capped at 200 styles)."""
        base = {"date_from": df, "date_to": dt}
        if brand:
            base["product"] = brand
        if len(cs) <= 1 and len(chs) <= 1:
            data = await fetch("/sor", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            })
            return data or []
        results = await multi_fetch("/sor", base, cs, chs)
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for row in g:
                s = row.get("style_name")
                if not s:
                    continue
                if s not in merged:
                    merged[s] = {**row}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales", "current_stock"):
                        merged[s][f] = (merged[s].get(f) or 0) + (row.get(f) or 0)
        return list(merged.values())

    # Historical existence (all styles with any sale before cutoff)
    # Recent + period use /sor to get current_stock & SOR for those styles.
    old_styles_raw, recent, period = await asyncio.gather(
        styles_call("2020-01-01", pre_cutoff_iso),
        sor_call(cutoff_iso, to_iso),
        sor_call(date_from, date_to),
    )

    old_styles = {r.get("style_name") for r in old_styles_raw if r.get("style_name")}
    new_styles = [r for r in recent if r.get("style_name") and r.get("style_name") not in old_styles]

    period_map: Dict[str, Dict[str, Any]] = {r.get("style_name"): r for r in period if r.get("style_name")}

    out: List[Dict[str, Any]] = []
    for r in new_styles:
        p = period_map.get(r.get("style_name")) or {}
        out.append({
            "style_name": r.get("style_name"),
            "brand": r.get("brand"),
            "collection": r.get("collection"),
            "product_type": r.get("product_type"),
            # Period slice
            "units_sold_period": p.get("units_sold") or 0,
            "total_sales_period": p.get("total_sales") or 0,
            # Since launch (last 90d)
            "units_sold_launch": r.get("units_sold") or 0,
            "total_sales_launch": r.get("total_sales") or 0,
            "current_stock": r.get("current_stock") or 0,
            "sor_percent": r.get("sor_percent") or 0,
        })
    out.sort(key=lambda x: x.get("total_sales_period") or 0, reverse=True)
    return out


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
# Auth + admin routers come first (they bypass the api_router auth dependency).
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(chat_router)
app.include_router(api_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_cors_origin_regex = os.environ.get("CORS_ORIGIN_REGEX") or None
# iOS Safari STRICTLY rejects `Access-Control-Allow-Origin: *` combined with
# `allow_credentials=True` (Chrome/Android tolerate it). When credentials are
# in play we MUST advertise an explicit origin — either from the allow_origins
# list or via allow_origin_regex — so Safari will accept the response.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins or ["*"],
    allow_origin_regex=_cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
    max_age=600,
)
# Activity logging — runs after the request so it sees the final status_code.
app.add_middleware(ActivityLogMiddleware)


@app.on_event("startup")
async def startup():
    await seed_admin()


@app.on_event("shutdown")
async def shutdown():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
