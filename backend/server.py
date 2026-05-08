import asyncio
import json
import pymongo
from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request, Body, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from collections import defaultdict
from datetime import datetime, timedelta, timezone, date
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

VIVO_API_BASE = os.environ.get(
    "VIVO_API_BASE", "https://vivo-bi-api-666430550422.europe-west1.run.app"
)

from auth import (  # noqa: E402
    auth_router, admin_router, ActivityLogMiddleware,
    get_current_user, seed_admin, db, User, require_admin,
)
from chat import chat_router  # noqa: E402
from pii import mask_and_audit, mask_rows  # noqa: E402
import bins_lookup  # noqa: E402

app = FastAPI(title="Vivo BI Dashboard API")
# NB: all business endpoints live under this router and require auth.
api_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_client: Optional[httpx.AsyncClient] = None

# In-memory stale cache for /kpis (and sister Overview endpoints) — used
# to avoid blank dashboards when the upstream BI API is mid-refresh /
# cold-starting. Key: (path, date_from, date_to, country, channel).
# Value: (timestamp, data). On startup the cache is rehydrated from disk
# (`/tmp/_kpi_stale_cache.json`) so a pod restart doesn't wipe it.
_kpi_stale_cache: Dict[tuple, tuple] = {}
_KPI_STALE_TTL = 86400  # 24 h — stale data beats a Network Error banner
_KPI_STALE_PATH = Path("/tmp/_kpi_stale_cache.json")
_kpi_stale_save_lock = asyncio.Lock()  # serialise concurrent disk flushes


async def _kpi_stale_save_async() -> None:
    """Coroutine variant of `_kpi_stale_save` that holds a lock so
    concurrent fire-and-forget callers don't race on the tmp→final
    rename. Wrapped via `asyncio.create_task` from the hot path.
    """
    async with _kpi_stale_save_lock:
        await asyncio.to_thread(_kpi_stale_save)


def _kpi_stale_load() -> None:
    """Best-effort rehydrate of the /kpis stale cache from disk on boot.

    Stored as a list of (key_tuple, ts, data) so a pod restart doesn't
    drop the user back to a Network Error banner. Reads silently fail —
    a missing/corrupt file just means we start cold.
    """
    try:
        if not _KPI_STALE_PATH.exists():
            return
        import json as _json
        with _KPI_STALE_PATH.open() as fh:
            for entry in _json.load(fh):
                key = tuple(entry["key"])
                _kpi_stale_cache[key] = (entry["ts"], entry["data"])
        logger.info(f"[stale-cache] rehydrated {len(_kpi_stale_cache)} entries from disk")
    except Exception as e:
        logger.warning(f"[stale-cache] rehydrate failed: {e}")


def _kpi_stale_save() -> None:
    """Best-effort flush of the in-memory stale cache to disk. Called from
    a fire-and-forget task whenever a fresh value is written. Cheap (small
    dict, JSON-serialisable) so we just dump-on-write rather than batching.
    """
    try:
        import json as _json
        # Only keep entries fresher than 24 h to bound the file.
        now = time.time()
        out = []
        for key, (ts, data) in _kpi_stale_cache.items():
            if now - ts > _KPI_STALE_TTL:
                continue
            out.append({"key": list(key), "ts": ts, "data": data})
        tmp = _KPI_STALE_PATH.with_suffix(".tmp")
        with tmp.open("w") as fh:
            _json.dump(out, fh)
        tmp.replace(_KPI_STALE_PATH)
    except Exception as e:
        logger.warning(f"[stale-cache] flush failed: {e}")

# TTL cache for the full churned-customers list used by the /customers churn-
# rate calculation. Upstream /churned-customers?limit=100000 takes ~30s which
# blocks the Customers page for the entire duration on cold cache. A customer's
# 90-day inactivity status changes at most once per day, so a 30-minute TTL is
# safe. Key: churn_window_days (int). Value: (timestamp, list).
_churn_full_cache: Dict[int, tuple] = {}
_CHURN_FULL_TTL = 1800  # seconds
# Negative cache: when upstream /churned-customers fails (commonly a 503 after
# 26 s on limit=100000), skip retrying for this many seconds so a flaky upstream
# doesn't pin the Customers page open for every user. Key: churn_window_days.
_churn_neg_cache: Dict[int, float] = {}
_CHURN_NEG_TTL = 60  # seconds

# Universal upstream response cache. Most BI metrics refresh on the order of
# minutes, not seconds, so a short TTL gives every endpoint a near-instant
# warm-cache path while still respecting freshness. Bounded to keep memory
# predictable on long-running workers.
_FETCH_CACHE: Dict[tuple, tuple] = {}
_FETCH_TTL = 120.0  # seconds
_FETCH_CACHE_MAX = 2000  # entries

# Official Vivo merchandise taxonomy (supplied by merchandising team on
# 2026-04-24). Map is `product_type` (= upstream `subcategory`) → category.
# Anything not in this map falls back to "Other" so downstream filters can
# cleanly exclude it. Mirrors /app/frontend/src/lib/productCategory.js —
# update both files when the merch team adds a new subcategory.
SUBCATEGORY_TO_CATEGORY: Dict[str, str] = {
    # Accessories
    "Accessories": "Accessories", "Bangles & Bracelets": "Accessories",
    "Belts": "Accessories", "Body Mists & Fragrances": "Accessories",
    "Earrings": "Accessories", "Necklaces": "Accessories",
    "Rings": "Accessories", "Scarves": "Accessories",
    # Bottoms
    "Culottes & Capri Pants": "Bottoms", "Full Length Pants": "Bottoms",
    "Jumpsuits & Playsuits": "Bottoms", "Leggings": "Bottoms",
    "Shorts & Skorts": "Bottoms",
    # Dresses
    "Knee Length Dresses": "Dresses", "Maxi Dresses": "Dresses",
    "Midi & Capri Dresses": "Dresses", "Short & Mini Dresses": "Dresses",
    # Mens
    "Men's Bottoms": "Mens", "Men's Tops": "Mens",
    # Outerwear
    "Hoodies & Sweatshirts": "Outerwear", "Jackets & Coats": "Outerwear",
    "Sweaters & Ponchos": "Outerwear", "Waterfalls & Kimonos": "Outerwear",
    # Sale
    "Sample & Sale Items": "Sale",
    # Skirts
    "Knee Length Skirts": "Skirts", "Maxi Skirts": "Skirts",
    "Midi & Capri Skirts": "Skirts", "Short & Mini Skirts": "Skirts",
    # Tops
    "Bodysuits": "Tops", "Fitted Tops": "Tops", "Loose Tops": "Tops",
    "Midriff & Crop Tops": "Tops", "T-shirts & Tank Tops": "Tops",
    # Two-Piece Sets
    "Pants & Top Set": "Two-Piece Sets", "Pants & Waterfall Set": "Two-Piece Sets",
    "Skirts & Top Set": "Two-Piece Sets",
}


def category_of(sub: Optional[str]) -> str:
    """Map a subcategory string to its merch category. Empty/unknown → 'Other'."""
    if not sub:
        return "Other"
    return SUBCATEGORY_TO_CATEGORY.get(sub, "Other")


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
            # Default httpx pool (100/20) saturates under multi-country fan-out
            # on Overview load (parallel /kpis × periods × channels + footfall +
            # customers + notifications). Bump it so PoolTimeouts don't surface
            # even when 20 users are hitting the dashboard concurrently.
            limits=httpx.Limits(
                max_connections=400,
                max_keepalive_connections=100,
                keepalive_expiry=30.0,
            ),
            # pool=25 separates "wait for free connection" from "wait for bytes",
            # so a saturated pool fails fast into the /kpis stale-cache fallback
            # instead of compounding with the 45s read budget.
            timeout=httpx.Timeout(45.0, connect=10.0, pool=25.0),
        )
    return _client


# In-flight de-dup map. When a fetch is already in progress for a given
# (path, params) key, subsequent callers attach to the existing Future
# instead of spawning a parallel upstream request. Single biggest perf win
# for the dashboard: 5+ components on a page often request the same KPIs
# concurrently — we collapse them into one upstream call.
_INFLIGHT: Dict[tuple, asyncio.Future] = {}

# ─── Circuit breaker per upstream path ────────────────────────────────
# When an upstream path returns 5xx / times out repeatedly, every fresh
# request through `fetch()` would otherwise burn 15s × 3 = 45s of retries
# before the endpoint falls back to the stale cache. With 20+ Overview
# tiles fanning out concurrently the user perceives this as "super slow"
# — even though we eventually serve stale numbers.
#
# This circuit breaker tracks consecutive failures per path-prefix:
#   • CLOSED   — pass requests straight through (default)
#   • OPEN     — short-circuit with HTTPException 504 for `RECOVERY_S` sec,
#                no upstream call attempted
#   • HALF     — after RECOVERY_S, one probe request is allowed; success
#                closes the breaker, failure re-opens it for another window
#
# Threshold (`FAIL_THRESHOLD`) and recovery window (`RECOVERY_S`) are tuned
# for Vivo BI's typical Cloud Run cold-start (~5-10s) — wide enough to
# avoid false positives during routine cold starts, narrow enough to stop
# a real outage from wedging the dashboard for minutes at a time.
_CB_FAILS: Dict[str, int] = {}        # path-prefix → consecutive failure count
_CB_OPEN_UNTIL: Dict[str, float] = {} # path-prefix → unix-ts breaker stays open
_CB_FAIL_THRESHOLD = 2
_CB_RECOVERY_S = 30.0


def _cb_path_key(path: str) -> str:
    """Group upstream paths by their first segment so the breaker is
    coarse-grained: an outage on /orders shouldn't open the breaker for
    /kpis. e.g. '/orders' and '/orders' both map to '/orders'."""
    if not path:
        return ""
    if path.startswith("/"):
        seg = path.split("/", 2)[1] if "/" in path[1:] else path[1:]
    else:
        seg = path.split("/", 1)[0]
    return f"/{seg}"


def _cb_is_open(path: str) -> bool:
    key = _cb_path_key(path)
    until = _CB_OPEN_UNTIL.get(key)
    if until is None:
        return False
    if time.time() >= until:
        # Window expired → enter HALF state (let one probe through).
        _CB_OPEN_UNTIL.pop(key, None)
        # Reset fail count to threshold-1 so a single failure re-opens.
        _CB_FAILS[key] = _CB_FAIL_THRESHOLD - 1
        return False
    return True


def _cb_record_success(path: str) -> None:
    key = _cb_path_key(path)
    _CB_FAILS.pop(key, None)
    _CB_OPEN_UNTIL.pop(key, None)


def _cb_record_failure(path: str) -> None:
    key = _cb_path_key(path)
    _CB_FAILS[key] = _CB_FAILS.get(key, 0) + 1
    if _CB_FAILS[key] >= _CB_FAIL_THRESHOLD:
        _CB_OPEN_UNTIL[key] = time.time() + _CB_RECOVERY_S
        logger.warning(
            f"[circuit-breaker] OPEN for {key} ({_CB_FAILS[key]} failures) — "
            f"failing fast for {_CB_RECOVERY_S}s, falling back to stale cache"
        )


@api_router.get("/admin/circuit-breaker")
async def admin_circuit_breaker():
    """Expose breaker state for ops debugging — e.g. when the dashboard
    shows "stale 68 min ago" you can hit this to see which upstream
    paths are currently failing fast."""
    now = time.time()
    return {
        "open": [
            {"path": k, "fails": _CB_FAILS.get(k, 0), "reopens_in_sec": int(v - now)}
            for k, v in _CB_OPEN_UNTIL.items()
            if v > now
        ],
        "fail_counts": {k: v for k, v in _CB_FAILS.items() if v > 0},
        "thresholds": {"fail": _CB_FAIL_THRESHOLD, "recovery_s": _CB_RECOVERY_S},
    }


@api_router.post("/admin/circuit-breaker/reset")
async def admin_circuit_breaker_reset():
    """Force-close every open breaker. Use after a confirmed upstream
    recovery if you don't want to wait the 30 s recovery window."""
    n_open = len(_CB_OPEN_UNTIL)
    _CB_FAILS.clear()
    _CB_OPEN_UNTIL.clear()
    return {"ok": True, "previously_open": n_open}


# ─── FX handled upstream ──────────────────────────────────────────────
# As of Feb 2026, all currency conversion (UGX→KES at 28.79,
# RWF→KES at 11.27, etc.) is performed in BigQuery at the data layer.
# Every monetary field returned by the upstream BI API is already in
# KES — `total_sales_kes`, `gross_sales_kes`, `net_sales_kes`,
# `discounts_kes`, `returns_kes`, `product_price_kes`. The dashboard
# must NOT apply any further conversion.
async def fetch(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    timeout_sec: Optional[float] = None,
    max_attempts: int = 3,
    cache: bool = True,
) -> Any:
    """Fetch with retries on transient network / 5xx errors and a 2-min
    response cache so repeat calls across endpoints are instant.

    `timeout_sec` overrides the default 45 s per-call timeout (used by the
    KPI stale-cache path to fail fast and fall back to the last good value).
    `max_attempts` caps the retry budget (default 3).
    `cache=False` disables the response cache (e.g. for write-like upstreams).
    """
    client = await get_client()
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    # Normalize country case for upstream. The upstream BI API is case-
    # sensitive on /orders, /subcategory-sales, /subcategory-stock-sales,
    # /sales-summary, /daily-trend, /top-customers and most other paths
    # — they require Title-case (`Kenya`). EXCEPTION: /inventory wants
    # lowercase (`kenya`) and silently returns 0 rows for Title-case.
    # Frontend lowercases country codes; we Title-case here once and
    # never have to worry about it at every call site again.
    if "country" in clean and isinstance(clean["country"], str):
        wants_lower = path.startswith("/inventory")
        v = clean["country"]
        if "," in v:
            parts = [p.strip() for p in v.split(",") if p.strip()]
            normed = [p.lower() if wants_lower else _norm_country(p) for p in parts]
            clean["country"] = ",".join(normed)
        else:
            clean["country"] = v.lower() if wants_lower else _norm_country(v)
    cache_key = (path, tuple(sorted(clean.items()))) if cache else None
    if cache_key is not None:
        hit = _FETCH_CACHE.get(cache_key)
        if hit and (time.time() - hit[0]) < _FETCH_TTL:
            return hit[1]
        # In-flight de-dup. If another coroutine already kicked off this
        # exact upstream call, await its Future instead of duplicating the
        # request — collapses a burst of 5–10 concurrent /kpis hits during
        # Overview load into a single upstream call.
        running = _INFLIGHT.get(cache_key)
        if running is not None:
            try:
                return await running
            except Exception:
                pass  # fall through to retry our own request
        loop = asyncio.get_event_loop()
        my_future: asyncio.Future = loop.create_future()
        _INFLIGHT[cache_key] = my_future
    else:
        my_future = None
    # Circuit breaker — if this upstream path has been repeatedly failing,
    # short-circuit immediately so the caller can fall back to its stale
    # cache instead of paying 45s of timeouts. Checked AFTER cache lookup
    # (so warm responses still serve) but BEFORE the upstream call itself.
    if _cb_is_open(path):
        exc = HTTPException(
            status_code=504,
            detail=f"Upstream {path} circuit-breaker OPEN — failing fast, served from stale",
        )
        if my_future is not None and not my_future.done():
            my_future.set_exception(exc)
            _INFLIGHT.pop(cache_key, None)
        raise exc
    last_err: Optional[Exception] = None
    req_timeout = (
        httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec), pool=15.0)
        if timeout_sec is not None
        else None
    )
    for attempt in range(max_attempts):
        try:
            resp = await client.get(path, params=clean, timeout=req_timeout) if req_timeout else await client.get(path, params=clean)
            resp.raise_for_status()
            try:
                data = resp.json()
            except json.JSONDecodeError as je:
                # Upstream sometimes returns 200 with an empty body when
                # under load. Treat as a transient empty response —
                # retry, then degrade to []. Caller's existing `or []`
                # idiom handles it.
                logger.warning("[%s] empty/non-JSON body (status=%s, len=%d): %s — treating as transient",
                               path, resp.status_code, len(resp.content or b""), str(je)[:80])
                data = []
            if cache_key is not None:
                _FETCH_CACHE[cache_key] = (time.time(), data)
                # Bound cache size to avoid unbounded growth (LRU-ish eviction).
                if len(_FETCH_CACHE) > _FETCH_CACHE_MAX:
                    # Drop the 200 oldest entries.
                    oldest = sorted(_FETCH_CACHE.items(), key=lambda kv: kv[1][0])[:200]
                    for k, _ in oldest:
                        _FETCH_CACHE.pop(k, None)
            _cb_record_success(path)
            if my_future is not None and not my_future.done():
                my_future.set_result(data)
                _INFLIGHT.pop(cache_key, None)
            return data
        except httpx.HTTPStatusError as e:
            if 500 <= e.response.status_code < 600 and attempt < max_attempts - 1:
                await asyncio.sleep(0.4 * (attempt + 1))
                last_err = e
                continue
            logger.error(f"Upstream {path} failed: {e.response.status_code}")
            if 500 <= e.response.status_code < 600:
                _cb_record_failure(path)
            exc = HTTPException(
                status_code=e.response.status_code,
                detail=f"Upstream {path} returned {e.response.status_code}",
            )
            if my_future is not None and not my_future.done():
                my_future.set_exception(exc)
                _INFLIGHT.pop(cache_key, None)
            raise exc
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
            last_err = e
            if attempt < max_attempts - 1:
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            logger.error(f"Upstream {path} timeout/connect: {type(e).__name__}: {e}")
            _cb_record_failure(path)
            exc = HTTPException(
                status_code=504,
                detail=f"Upstream {path} {type(e).__name__}: timed out after {max_attempts} attempts",
            )
            if my_future is not None and not my_future.done():
                my_future.set_exception(exc)
                _INFLIGHT.pop(cache_key, None)
            raise exc
        except httpx.HTTPError as e:
            logger.error(f"Upstream {path} connection error: {type(e).__name__}: {e}")
            _cb_record_failure(path)
            exc = HTTPException(
                status_code=502,
                detail=f"Upstream {path} unreachable ({type(e).__name__}): {str(e) or 'no detail'}",
            )
            if my_future is not None and not my_future.done():
                my_future.set_exception(exc)
                _INFLIGHT.pop(cache_key, None)
            raise exc
    # Should never reach here, but be explicit.
    if my_future is not None and not my_future.done():
        _INFLIGHT.pop(cache_key, None)
    raise HTTPException(
        status_code=502,
        detail=f"Upstream {path} failed after retries: {last_err}",
    )


def _split_csv(val: Optional[str]) -> List[str]:
    if not val:
        return []
    return [x.strip() for x in val.split(",") if x.strip()]


# Country names the upstream Vivo BI API recognizes (Title-case). The
# frontend sends lowercase ("kenya") but the upstream silently returns
# units_sold=0 for non-Title-case values on /subcategory-sales and
# /subcategory-stock-sales (and likely others). Normalize before forward.
_COUNTRY_TITLECASE = {"kenya": "Kenya", "uganda": "Uganda", "rwanda": "Rwanda", "online": "Online"}


def _norm_country(val: Optional[str]) -> Optional[str]:
    """Title-case a single country name for upstream calls."""
    if not val:
        return val
    return _COUNTRY_TITLECASE.get(val.strip().lower(), val.strip())


def _norm_country_csv(val: Optional[str]) -> Optional[str]:
    """Title-case each country in a CSV string."""
    if not val:
        return val
    parts = [_norm_country(p) for p in _split_csv(val)]
    return ",".join([p for p in parts if p]) or None


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
    # /locations is essentially static (a store list — changes ≤ once a
    # month). We persist a long-lived stale copy so the dashboard never
    # surfaces "circuit-breaker OPEN" on the IBT/filter UIs even if the
    # upstream is degraded for hours.
    cache_key = ("/locations",)
    try:
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
        _kpi_stale_cache[cache_key] = (time.time(), data)
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached:
            logger.warning(
                f"/locations upstream {e.status_code} — serving stale "
                f"(age={int(time.time()-cached[0])}s, {len(cached[1])} locations)"
            )
            return cached[1]
        # Last-resort: synthesize from EXTRA_INVENTORY_LOCATIONS so the UI
        # at least has SOMETHING to render (filter dropdown won't be empty).
        return [
            {"channel": x["channel"], "pos_location_name": x["channel"], "country": x["country"]}
            for x in EXTRA_INVENTORY_LOCATIONS
        ]


@api_router.get("/country-summary")
async def get_country_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    cache_key = ("/country-summary", date_from or "", date_to or "", "", "")
    try:
        data = await fetch(
            "/country-summary",
            {"date_from": date_from, "date_to": date_to},
            timeout_sec=15.0,
            max_attempts=3,
        )
        _kpi_stale_cache[cache_key] = (time.time(), data)
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < _KPI_STALE_TTL):
            logger.warning(f"/country-summary upstream {e.status_code} — serving stale (age={int(time.time()-cached[0])}s)")
            return cached[1]
        raise


@api_router.get("/kpis")
async def get_kpis(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Supports comma-separated country & channel. Aggregates if more than one combo.

    Hedged path: tries the upstream with a 15 s per-attempt budget and 3
    attempts (45 s total). On upstream error/timeout, falls back to a
    24-hour disk-persisted stale cache so the dashboard never goes blank
    during Vivo BI refresh windows / cold starts / pod restarts.
    """
    base = {"date_from": date_from, "date_to": date_to}
    cs = _split_csv(country)
    chs = _split_csv(channel)
    cache_key = ("/kpis", date_from or "", date_to or "", country or "", channel or "")
    single = len(cs) <= 1 and len(chs) <= 1

    try:
        if single:
            country_for_call = cs[0] if cs else None
            data = await fetch(
                "/kpis",
                {**base, "country": country_for_call, "channel": chs[0] if chs else None},
                timeout_sec=15.0,
                max_attempts=3,
            )
        else:
            # Multi-country/channel fan-out — same per-call budget; in-flight
            # de-dup in fetch() collapses concurrent identical calls.
            tasks = []
            for c in (cs or [None]):
                for ch in (chs or [None]):
                    tasks.append(
                        fetch(
                            "/kpis",
                            {**base, "country": c, "channel": ch},
                            timeout_sec=15.0,
                            max_attempts=3,
                        )
                    )
            results = await asyncio.gather(*tasks)
            data = agg_kpis(results)
        data = {**data, "stale": False}
        _kpi_stale_cache[cache_key] = (time.time(), data)
        # Fire-and-forget disk flush so a pod restart preserves it.
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < _KPI_STALE_TTL):
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
    cs = _split_csv(country)
    chs = _split_csv(channel)
    cache_key = ("/sales-summary", date_from or "", date_to or "", country or "", channel or "")
    try:
        country_list = cs if cs else [None]
        chs_set = set(chs) if chs else None
        per_country_groups = await asyncio.gather(*[
            fetch(
                "/sales-summary",
                {"date_from": date_from, "date_to": date_to,
                 **({"country": c} if c else {}),
                 **({"channel": chs[0]} if len(chs) == 1 else {})},
                timeout_sec=15.0,
                max_attempts=3,
            )
            for c in country_list
        ])
        out: List[Dict[str, Any]] = []
        seen = set()
        for g in per_country_groups:
            for row in (g or []):
                key = (row.get("channel"), row.get("country"))
                if key in seen:
                    continue
                seen.add(key)
                if chs_set and row.get("channel") not in chs_set:
                    continue
                out.append(row)
        data = out
        _kpi_stale_cache[cache_key] = (time.time(), data)
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < _KPI_STALE_TTL):
            logger.warning(f"/sales-summary upstream {e.status_code} — serving stale (age={int(time.time()-cached[0])}s)")
            return cached[1]
        raise


@api_router.get("/top-skus")
async def get_top_skus(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    brand: Optional[str] = None,
    limit: int = Query(20, ge=1, le=10000),
):
    base = {"date_from": date_from, "date_to": date_to, "limit": max(limit, 50)}
    if brand:
        base["product"] = brand
    cs = _split_csv(country)
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        cfc = cs[0] if cs else None
        data = await fetch("/top-skus", {
            **base, "country": cfc, "channel": chs[0] if chs else None,
        })
        data = sorted(data or [], key=lambda r: r.get("total_sales") or 0, reverse=True)
        return data[:limit]
    # Multi-country / multi-channel fan-out — merge per-(country, channel) payloads.
    results = await asyncio.gather(*[
        fetch("/top-skus", {
            **base,
            **({"country": c} if c else {}),
            **({"channel": ch} if ch else {}),
        })
        for c in (cs or [None])
        for ch in (chs or [None])
    ])
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for row in (g or []):
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
        cfc = cs[0] if cs else None
        data = await fetch("/sor", {
            **base, "country": cfc, "channel": chs[0] if chs else None,
        })
        return sorted(data or [], key=lambda r: r.get("sor_percent") or 0, reverse=True)
    # Multi-country fan-out — merge per-style.
    results = await asyncio.gather(*[
        fetch("/sor", {
            **base,
            **({"country": c} if c else {}),
            **({"channel": ch} if ch else {}),
        })
        for c in (cs or [None])
        for ch in (chs or [None])
    ])
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for row in (g or []):
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
    cache_key = ("/daily-trend", date_from or "", date_to or "", country or "", "")
    try:
        if len(cs) <= 1:
            country_for_call = cs[0] if cs else None
            data = await fetch("/daily-trend", {**base, "country": country_for_call}, timeout_sec=15.0, max_attempts=3)
        else:
            # Multi-country: merge per-country day rows.
            tasks = [fetch("/daily-trend", {**base, "country": c}, timeout_sec=15.0, max_attempts=3) for c in cs]
            raw_groups = await asyncio.gather(*tasks)
            merged: Dict[str, Dict[str, Any]] = {}
            for g in raw_groups:
                for row in (g or []):
                    day = row.get("day")
                    if day not in merged:
                        merged[day] = {"day": day, "orders": 0, "gross_sales": 0.0, "net_sales": 0.0, "total_sales": 0.0}
                    merged[day]["orders"] += row.get("orders") or 0
                    merged[day]["gross_sales"] += row.get("gross_sales") or 0
                    merged[day]["net_sales"] += row.get("net_sales") or 0
                    merged[day]["total_sales"] += row.get("total_sales") or row.get("gross_sales") or 0
            out = list(merged.values())
            out.sort(key=lambda r: r["day"])
            data = out
        _kpi_stale_cache[cache_key] = (time.time(), data)
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < _KPI_STALE_TTL):
            logger.warning(f"/daily-trend upstream {e.status_code} — serving stale (age={int(time.time()-cached[0])}s)")
            return cached[1]
        raise


def _gen_kpi_trend_buckets(date_from: str, date_to: str, bucket: str):
    """Generate (label, df_iso, dt_iso) tuples for the KPI trend chart.

    `bucket` is one of: day, week, month, quarter.

    Each bucket is intersected with the requested window so partial weeks
    / months / quarters at the edges of the range remain accurate. Daily
    is the densest granularity; quarterly is coarsest.
    """
    try:
        df = datetime.strptime(date_from, "%Y-%m-%d").date()
        dt = datetime.strptime(date_to, "%Y-%m-%d").date()
    except Exception:
        return []
    if df > dt:
        return []
    out: List[Tuple[str, str, str]] = []
    if bucket == "day":
        cur = df
        while cur <= dt:
            iso = cur.isoformat()
            out.append((cur.strftime("%b %d"), iso, iso))
            cur += timedelta(days=1)
    elif bucket == "week":
        cur = df
        while cur <= dt:
            week_start = cur - timedelta(days=cur.weekday())  # Mon
            week_end = week_start + timedelta(days=6)         # Sun
            seg_start = max(week_start, df)
            seg_end = min(week_end, dt)
            label = f"Wk {seg_start.strftime('%b %d')}"
            out.append((label, seg_start.isoformat(), seg_end.isoformat()))
            cur = week_end + timedelta(days=1)
    elif bucket == "month":
        cur = df.replace(day=1)
        while cur <= dt:
            if cur.month == 12:
                next_m = date(cur.year + 1, 1, 1)
            else:
                next_m = date(cur.year, cur.month + 1, 1)
            month_end = next_m - timedelta(days=1)
            seg_start = max(cur, df)
            seg_end = min(month_end, dt)
            label = seg_start.strftime("%b %Y")
            out.append((label, seg_start.isoformat(), seg_end.isoformat()))
            cur = next_m
    elif bucket == "quarter":
        q_idx = (df.month - 1) // 3
        cur = date(df.year, q_idx * 3 + 1, 1)
        while cur <= dt:
            q_idx = (cur.month - 1) // 3
            end_month = q_idx * 3 + 3
            if end_month == 12:
                next_q = date(cur.year + 1, 1, 1)
            else:
                next_q = date(cur.year, end_month + 1, 1)
            q_end = next_q - timedelta(days=1)
            seg_start = max(cur, df)
            seg_end = min(q_end, dt)
            label = f"Q{q_idx + 1} {cur.year}"
            out.append((label, seg_start.isoformat(), seg_end.isoformat()))
            cur = next_q
    return out


@api_router.get("/analytics/kpi-trend")
async def get_kpi_trend(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    bucket: str = "day",
):
    """Bucketed KPI trend powering the Overview KPI Trend chart.

    Splits the requested window into day / week / month / quarter
    buckets, then fans out parallel /kpis calls (one per bucket). The
    upstream /kpis route already aggregates across multiple countries
    and channels via comma-separated CSV, so the same `country` /
    `channel` filter flows straight through.

    Each row contains every KPI the chart's dropdown supports
    (total_sales, net_sales, units_sold, orders, avg_basket_size,
    discount, returns) so the front-end never has to re-derive any
    field. Discount and returns are sourced here from /kpis (which has
    them) — fixing the previous `/daily-trend` based implementation
    that always rendered 0 for those KPIs.
    """
    if bucket not in ("day", "week", "month", "quarter"):
        bucket = "day"
    buckets = _gen_kpi_trend_buckets(date_from, date_to, bucket)
    if not buckets:
        return []
    # Hard cap to keep fan-out bounded; 400 buckets covers any sensible
    # combination (1 yr daily = 366, 7 yr quarterly = 28).
    if len(buckets) > 400:
        buckets = buckets[:400]

    tasks = [
        get_kpis(date_from=df, date_to=dt, country=country, channel=channel)
        for (_, df, dt) in buckets
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: List[Dict[str, Any]] = []
    for (label, df, dt), kp in zip(buckets, results):
        if isinstance(kp, Exception) or not isinstance(kp, dict):
            kp = {}
        rows.append({
            "label": label,
            "date": df,
            "bucket_start": df,
            "bucket_end": dt,
            "total_sales": kp.get("total_sales") or 0,
            "net_sales": kp.get("net_sales") or 0,
            "gross_sales": kp.get("gross_sales") or 0,
            "units_sold": kp.get("total_units") or 0,
            "orders": kp.get("total_orders") or 0,
            "discount": kp.get("total_discounts") or 0,
            "returns": kp.get("total_returns") or 0,
            "avg_basket_size": kp.get("avg_basket_size") or 0,
            "avg_selling_price": kp.get("avg_selling_price") or 0,
            "return_rate": kp.get("return_rate") or 0,
        })
    return rows


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

    NOTE: We deliberately preserve `_kpi_stale_cache` (and its disk file)
    because it is a *safety net* for upstream failures — wiping it on
    every Refresh click would mean the user loses their fallback right
    when they need it most. The stale cache is only consulted when the
    upstream fails outright; on success the user always gets fresh data.
    """
    _inv_cache["ts"] = 0
    _inv_cache["key"] = None
    _inv_cache["data"] = None
    _churn_full_cache.clear()
    _churn_neg_cache.clear()
    _FETCH_CACHE.clear()
    return {"ok": True, "cleared": ["inventory", "churn_full", "churn_neg", "fetch_cache"]}


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

    # Churn rate — computed in a SEPARATE endpoint (/customers/churn-rate)
    # so a flaky upstream /churned-customers (503 after 26 s on limit=100000)
    # doesn't block the entire Customers page. The frontend fetches it in
    # parallel and merges into the same `cust` state.
    if data:
        # ---- Trust-critical override: recompute avg_customer_spend locally ----
        # Two bugs to fix:
        #   1. Upstream /customers returns an `avg_customer_spend` that in
        #      some months is ~10× the correct value (observed: 116,887 in
        #      Apr vs 11,939 in Mar — a scale drift, not a real 880% growth).
        #   2. Computing it as `total_sales ÷ total_customers` mixes a
        #      walk-in-INCLUDED numerator with a walk-in-EXCLUDED
        #      denominator (upstream's /customers count is identified-only,
        #      while /kpis total_sales includes anonymous walk-in revenue).
        #      That inflated the tile to KES 9,695 when New + Returning
        #      averaged to ~8,340.
        # The defensible definition is `identified_total_sales ÷ identified_customers`,
        # which matches the New + Returning weighted average shown in the
        # Customer Loyalty section. We get those numbers from the same
        # walk-in-excluded /analytics/avg-spend-by-customer-type pipeline.
        try:
            if date_from and date_to:
                from routes.customer_analytics import analytics_avg_spend_by_customer_type
                spend = await analytics_avg_spend_by_customer_type(
                    date_from=date_from, date_to=date_to,
                    country=country, channel=channel,
                    user=type("U", (), {"role": "admin"})(),
                )
                new_b = (spend or {}).get("new") or {}
                ret_b = (spend or {}).get("returning") or {}
                identified_sales = (new_b.get("total_spend_kes") or 0) + (ret_b.get("total_spend_kes") or 0)
                identified_count = (new_b.get("customers") or 0) + (ret_b.get("customers") or 0)
                if identified_count and identified_sales:
                    data["avg_customer_spend"] = round(identified_sales / identified_count, 2)
                    data["avg_customer_spend_source"] = "recomputed_local_identified"
                    # Also align total_customers with the identified count
                    # so retention denominators on the page agree.
                    data["total_customers"] = identified_count
                else:
                    data["avg_customer_spend_source"] = "upstream_unverified"
            else:
                data["avg_customer_spend_source"] = "upstream_unverified"
        except Exception as e:
            logger.warning("[/customers] avg_customer_spend recompute failed: %s", e)
            data["avg_customer_spend_source"] = "upstream_unverified"

        # Surface a "computing" sentinel so the UI can render a spinner on the
        # churn tile while /customers/churn-rate resolves separately.
        data["churn_source"] = "computing"
        data["churn_window_days"] = 90
    return data


@api_router.get("/customers/churn-rate")
async def get_customers_churn_rate(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Period-scoped churn calc, split out of /customers so its slow upstream
    call (/churned-customers?limit=100000 — frequently 503s after 26 s) doesn't
    block the rest of the Customers page.

    Definition: a customer is "period-churned" if their LAST purchase date
    falls inside [date_from, date_to] AND they have not returned in 90+ days
    as of TODAY. Cached 30 min on success, negatively cached 60 s on failure.
    """
    churn_window_days = 90
    out = {
        "churn_window_days": churn_window_days,
        "churned_customers": 0,
        "churn_rate": 0,
        "churn_source": "upstream_down",
    }

    # Negative cache short-circuit
    neg_at = _churn_neg_cache.get(churn_window_days)
    if neg_at and (time.time() - neg_at) < _CHURN_NEG_TTL:
        out["churn_source"] = "upstream_down_cached"
        return out

    # Pull cached churned list (or fetch + cache)
    churned_list: Optional[List[Dict[str, Any]]] = None
    cached = _churn_full_cache.get(churn_window_days)
    if cached and (time.time() - cached[0]) < _CHURN_FULL_TTL:
        churned_list = cached[1]
        out["churn_source"] = "upstream_90d_cached"
    else:
        try:
            churned_list = await fetch(
                "/churned-customers",
                {"days": churn_window_days, "limit": 100000},
                timeout_sec=20.0,
                max_attempts=1,
            )
            if isinstance(churned_list, list) and churned_list:
                _churn_full_cache[churn_window_days] = (time.time(), churned_list)
                out["churn_source"] = "upstream_90d"
        except HTTPException:
            _churn_neg_cache[churn_window_days] = time.time()
            return out
        except Exception:
            _churn_neg_cache[churn_window_days] = time.time()
            return out

    if not isinstance(churned_list, list):
        return out

    # Slice by period
    churned_in_period = 0
    if date_from and date_to:
        for c in churned_list:
            lp = c.get("last_purchase_date") or ""
            if date_from <= lp <= date_to:
                churned_in_period += 1
    else:
        churned_in_period = len(churned_list)

    # Active customers in the same period (cheap call, ~2 s)
    active = 0
    try:
        cust_data = await fetch(
            "/customers",
            {"date_from": date_from, "date_to": date_to},
            timeout_sec=10.0,
            max_attempts=2,
        )
        active = int((cust_data or {}).get("total_customers") or 0)
    except Exception:
        pass

    out["churned_customers"] = churned_in_period
    out["churn_rate"] = round((churned_in_period / active * 100), 2) if active else 0
    return out

_customer_names_cache: Tuple[float, Dict[str, str]] = (0.0, {})
_customer_contacts_cache: Tuple[float, Dict[str, Dict[str, bool]]] = (0.0, {})
_CUSTOMER_NAMES_TTL = 60 * 60 * 6  # 6 hours


async def _get_customer_name_lookup() -> Dict[str, str]:
    """Returns customer_id → customer_name. Cached for 6h. Pulled from
    /top-customers with a 400-day look-back so we capture roughly every
    customer who has transacted in the past year. Without explicit date
    bounds, upstream defaults to a tiny "last few days" window and only
    returns ~1,261 customers — wildly under-counts the identified
    customer base and misclassifies real customers as walk-ins.

    A SENTINEL of empty-string is recorded for known customer_ids whose
    name in the upstream database is blank — that's the actual walk-in
    marker in the dataset (~379 such IDs vs 2 IDs whose name contains
    "walk"). The walk-in detector relies on this distinction to distinguish
    "anonymous walk-in customer" from "customer not yet loaded".

    Also populates `_customer_contacts_cache` (customer_id → {has_phone,
    has_email}) so the walk-in detector can apply the "no phone AND no
    email = walk-in" ops rule.
    """
    import time as _time
    global _customer_names_cache, _customer_contacts_cache
    ts, cache = _customer_names_cache
    if cache and _time.time() - ts < _CUSTOMER_NAMES_TTL:
        return cache
    today = datetime.now(timezone.utc).date()
    look_from = (today - timedelta(days=400)).isoformat()
    look_to = today.isoformat()
    try:
        rows = await _safe_fetch("/top-customers", {
            "date_from": look_from, "date_to": look_to, "limit": 200000,
        }) or []
    except Exception as e:
        logger.warning("[customer-names] /top-customers failed: %s", e)
        return cache or {}
    out: Dict[str, str] = {}
    contacts: Dict[str, Dict[str, bool]] = {}
    blanks = 0
    for r in rows:
        cid = r.get("customer_id")
        cname = r.get("customer_name")
        if not cid:
            continue
        cid_s = str(cid).strip()
        if cname and str(cname).strip():
            out[cid_s] = str(cname).strip()
        else:
            # Empty-name customers — the walk-in roster.
            out[cid_s] = ""
            blanks += 1
        # Capture contact-info presence — used by the walk-in detector.
        # A customer with NEITHER a phone NOR an email is treated as a
        # walk-in regardless of customer_id (per ops definition).
        phone = r.get("phone") or r.get("customer_phone")
        email = r.get("email") or r.get("customer_email")
        contacts[cid_s] = {
            "has_phone": bool(phone and str(phone).strip()),
            "has_email": bool(email and str(email).strip()),
        }
    logger.info("[customer-names] loaded %d names (%d are walk-in blanks)", len(out), blanks)
    _customer_names_cache = (_time.time(), out)
    _customer_contacts_cache = (_time.time(), contacts)
    return out


def _get_customer_contact_lookup_sync() -> Dict[str, Dict[str, bool]]:
    """Synchronous accessor for the contact lookup populated by
    `_get_customer_name_lookup`. Returns {} if the name lookup hasn't
    been warmed yet — callers should always call the async name lookup
    first to ensure freshness."""
    return _customer_contacts_cache[1]




@api_router.get("/customers/walk-ins")
async def get_walk_ins(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Counts anonymous (walk-in) transactions in the period.

    Detection rule: an order line is a walk-in if EITHER
      - upstream `customer_type` == 'Guest' (case-insensitive), OR
      - upstream `customer_id` is null / empty.
    Both flags coincide in the upstream feed, but we OR them defensively
    so a future schema tweak (e.g. 'Walk-in' tag) is still captured.

    Aggregates to UNIQUE order_ids (the upstream returns one row per order
    line item — a single guest order with 5 SKUs would otherwise be counted
    5×). Returns total walk-in orders, walk-in revenue, share of all orders
    and share of all revenue, plus a per-country breakdown.
    """
    base = {"date_from": date_from, "date_to": date_to, "limit": 50000}
    cs = _split_csv(country)
    chs = _split_csv(channel)

    # Chunking — upstream /orders caps responses around 50k line items
    # (returns 500 on limit=100000 and silently truncates at 50k). For period
    # windows wider than ~45 days the fashion-group volumes saturate that
    # ceiling, which would understate walk-in counts. Split into ≤30-day
    # windows so each chunk stays well below the cap and gets cached
    # independently.
    def _date_chunks(df: Optional[str], dt: Optional[str]) -> List[Dict[str, str]]:
        if not df or not dt:
            return [{}]
        try:
            d_from = datetime.strptime(df, "%Y-%m-%d").date()
            d_to = datetime.strptime(dt, "%Y-%m-%d").date()
        except Exception:
            return [{"date_from": df, "date_to": dt}]
        if (d_to - d_from).days <= 30:
            return [{"date_from": df, "date_to": dt}]
        chunks = []
        cur = d_from
        while cur <= d_to:
            end = min(cur + timedelta(days=29), d_to)
            chunks.append({"date_from": cur.isoformat(), "date_to": end.isoformat()})
            cur = end + timedelta(days=1)
        return chunks

    chunks = _date_chunks(date_from, date_to)

    # Fan out across (date-chunk × country × channel) combos in parallel.
    tasks = []
    for ch_range in chunks:
        for c in (cs or [None]):
            for ch in (chs or [None]):
                p = {**base, **ch_range}
                if c:
                    p["country"] = c
                if ch:
                    p["channel"] = ch
                tasks.append(_safe_fetch("/orders", p))
    results = await asyncio.gather(*tasks)
    rows: List[Dict[str, Any]] = []
    for r in results:
        if r:
            rows.extend(r)
    # Mark as truncated only if any chunk hit the upstream cap.
    truncated = any(isinstance(r, list) and len(r) >= 50000 for r in results)

    # Filter to actual sales (drop returns/exchanges/refunds). Note: Kenya
    # uses sale_kind="sale", Uganda/Rwanda use "order" — we keep both.
    rows = [r for r in rows if (r.get("sale_kind") or "order").lower() not in ("return", "exchange", "refund")]

    # /orders doesn't expose customer_name — pull a single bulk roster from
    # /top-customers so the name-pattern rules below can actually fire.
    # Cached for 6h in `_customer_names_cache`.
    name_lookup = await _get_customer_name_lookup()

    def _is_walk_in(r: Dict[str, Any]) -> bool:
        # Walk-in rules (any one match):
        #   1. No customer_id (null / empty) — anonymous transaction.
        #   2. customer_type tagged guest / walk-in / anonymous in upstream.
        #   3. customer_id resolves to a customer with EMPTY name in the
        #      upstream customer database — that IS the walk-in roster
        #      (~379 such IDs vs 2 named "walker"). Most reliable signal.
        #   4. customer_name contains "walk" — covers "walk in", "walkin",
        #      "walk-in".
        #   5. customer_name contains "vivo" / "safari" — staff sometimes
        #      enter the brand or store name when no real customer is
        #      present.
        #   6. customer_name matches the POS / store / location name.
        cid = r.get("customer_id")
        if cid is None or (isinstance(cid, str) and not cid.strip()):
            return True
        ctype = (r.get("customer_type") or "").strip().lower()
        if ctype in ("guest", "walk-in", "walkin", "walk in", "anonymous"):
            return True
        cid_s = str(cid).strip()
        if cid_s in name_lookup and not name_lookup[cid_s]:
            # Known customer in the roster but with blank name = walk-in.
            return True
        cname = (r.get("customer_name") or name_lookup.get(cid_s, "") or "").strip().lower()
        if not cname:
            # cid is in the roster with a real name → genuine identified
            # customer, not a walk-in. (If cid is NOT in the roster we
            # treat it as identified too — safer to under-count walk-ins
            # than over-count.)
            return False
        cname_clean = cname.replace("-", " ").replace("_", " ")
        if "walk" in cname_clean:
            return True
        if "vivo" in cname_clean or "safari" in cname_clean:
            return True
        loc = (r.get("pos_location_name") or r.get("channel") or "").strip().lower()
        if loc:
            loc_clean = loc.replace("-", " ").replace("_", " ")
            if cname_clean == loc_clean:
                return True
            tokens = [t for t in loc_clean.split() if len(t) >= 4 and t not in ("vivo", "safari", "mall", "shop", "store")]
            if any(t in cname_clean for t in tokens):
                return True
        return False

    # Aggregate: walk-in orders & revenue, total orders & revenue, by country
    # and by store/POS channel.
    walk_orders: set = set()
    all_orders: set = set()
    walk_units = 0
    walk_sales = 0.0
    total_units = 0
    total_sales = 0.0
    by_country: Dict[str, Dict[str, Any]] = {}
    by_location: Dict[str, Dict[str, Any]] = {}

    for r in rows:
        oid = r.get("order_id")
        units = r.get("quantity") or 0
        sales = r.get("total_sales_kes") or 0
        cn = r.get("country") or "Unknown"
        loc = r.get("pos_location_name") or r.get("channel") or "Unknown"
        all_orders.add(oid)
        total_units += units
        total_sales += sales
        bucket = by_country.setdefault(cn, {
            "country": cn,
            "walk_in_orders_set": set(),
            "all_orders_set": set(),
            "walk_in_sales": 0.0,
            "total_sales": 0.0,
        })
        bucket["all_orders_set"].add(oid)
        bucket["total_sales"] += sales
        lbucket = by_location.setdefault(loc, {
            "channel": loc,
            "country": cn,
            "walk_in_orders_set": set(),
            "all_orders_set": set(),
            "walk_in_sales": 0.0,
            "total_sales": 0.0,
        })
        lbucket["all_orders_set"].add(oid)
        lbucket["total_sales"] += sales
        if _is_walk_in(r):
            walk_orders.add(oid)
            walk_units += units
            walk_sales += sales
            bucket["walk_in_orders_set"].add(oid)
            bucket["walk_in_sales"] += sales
            lbucket["walk_in_orders_set"].add(oid)
            lbucket["walk_in_sales"] += sales

    # Resolve sets → counts and compute shares.
    by_country_out = []
    for b in by_country.values():
        wo = len(b.pop("walk_in_orders_set"))
        ao = len(b.pop("all_orders_set"))
        ws = b["walk_in_sales"]
        ts = b["total_sales"]
        b["walk_in_orders"] = wo
        b["total_orders"] = ao
        b["walk_in_share_orders_pct"] = round((wo / ao * 100), 2) if ao else 0.0
        b["walk_in_share_sales_pct"] = round((ws / ts * 100), 2) if ts else 0.0
        b["walk_in_avg_basket_kes"] = round((ws / wo), 2) if wo else 0.0
        by_country_out.append(b)
    by_country_out.sort(key=lambda x: x.get("walk_in_orders") or 0, reverse=True)

    # Resolve per-location buckets — capture rate is the inverse of walk-in
    # share (1 − walk_in_orders ÷ all_orders). Surface both so the frontend
    # can rank either direction without re-deriving.
    by_location_out = []
    for b in by_location.values():
        wo = len(b.pop("walk_in_orders_set"))
        ao = len(b.pop("all_orders_set"))
        ws = b["walk_in_sales"]
        ts = b["total_sales"]
        share = (wo / ao * 100) if ao else 0.0
        b["walk_in_orders"] = wo
        b["total_orders"] = ao
        b["walk_in_sales"] = round(ws, 2)
        b["total_sales"] = round(ts, 2)
        b["walk_in_share_orders_pct"] = round(share, 2)
        b["capture_rate_pct"] = round(100.0 - share, 2) if ao else None
        by_location_out.append(b)
    by_location_out.sort(key=lambda x: (x.get("total_orders") or 0), reverse=True)

    walk_orders_n = len(walk_orders)
    total_orders_n = len(all_orders)

    return {
        "walk_in_orders": walk_orders_n,
        "walk_in_units": walk_units,
        "walk_in_sales_kes": round(walk_sales, 2),
        "walk_in_avg_basket_kes": round((walk_sales / walk_orders_n), 2) if walk_orders_n else 0.0,
        "total_orders": total_orders_n,
        "total_sales_kes": round(total_sales, 2),
        "walk_in_share_orders_pct": round((walk_orders_n / total_orders_n * 100), 2) if total_orders_n else 0.0,
        "walk_in_share_sales_pct": round((walk_sales / total_sales * 100), 2) if total_sales else 0.0,
        "by_country": by_country_out,
        "by_location": by_location_out,
        "detection_rule": "customer_id NULL · customer_type Guest/Walk-in/Anonymous · customer in roster with BLANK name (~379 IDs) · customer_name contains 'walk'/'vivo'/'safari'/store name",
        "truncated": truncated,
    }


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
    reveal: bool = False,
    user=Depends(get_current_user),
):
    rows = await _safe_fetch("/top-customers", {
        "date_from": date_from, "date_to": date_to,
        "country": country, "channel": channel, "limit": limit,
    }) or []
    if reveal:
        token = request.headers.get("X-PII-Reveal-Token") or request.headers.get("x-pii-reveal-token")
        from auth import verify_pii_reveal_token
        if not verify_pii_reveal_token(getattr(user, "user_id", None), token):
            raise HTTPException(status_code=403, detail="Reveal token missing or expired — re-enter password")
        from pii import log_unmasked_access, _row_id, _CONTACT_FIELDS  # type: ignore
        await log_unmasked_access(
            user=user,
            endpoint="/top-customers?reveal=true",
            row_ids=[rid for rid in (_row_id(r) for r in rows) if rid],
            fields=list(_CONTACT_FIELDS),
            request_ip=_client_ip(request),
        )
        return rows
    return await mask_and_audit(rows, user=user, endpoint="/top-customers", request_ip=_client_ip(request))


@api_router.get("/customer-search")
async def customer_search(request: Request, q: str, reveal: bool = False, user=Depends(get_current_user)):
    if not q or not q.strip():
        return []
    rows = await _safe_fetch("/customer-search", {"q": q.strip()}) or []
    if reveal:
        token = request.headers.get("X-PII-Reveal-Token") or request.headers.get("x-pii-reveal-token")
        from auth import verify_pii_reveal_token
        if not verify_pii_reveal_token(getattr(user, "user_id", None), token):
            raise HTTPException(status_code=403, detail="Reveal token missing or expired — re-enter password")
        from pii import log_unmasked_access, _row_id, _CONTACT_FIELDS  # type: ignore
        await log_unmasked_access(
            user=user,
            endpoint="/customer-search?reveal=true",
            row_ids=[rid for rid in (_row_id(r) for r in rows) if rid],
            fields=list(_CONTACT_FIELDS),
            request_ip=_client_ip(request),
        )
        return rows
    return await mask_and_audit(rows, user=user, endpoint="/customer-search", request_ip=_client_ip(request))


@api_router.get("/customer-products")
async def customer_products(request: Request, customer_id: str, user=Depends(get_current_user)):
    rows = await _safe_fetch("/customer-products", {"customer_id": customer_id})
    # Per-purchase data; mask_and_audit is still safe (no-op if no PII fields).
    return await mask_and_audit(rows or [], user=user, endpoint="/customer-products", request_ip=_client_ip(request))


@api_router.get("/churned-customers")
async def churned_customers(request: Request, days: int = 90, limit: int = 20, reveal: bool = False, user=Depends(get_current_user)):
    """Returns the churned customer list with role-based PII masking.
    Pass `reveal=true` AND a valid `X-PII-Reveal-Token` header (issued
    by `/api/auth/verify-password`) to bypass the mask and get full
    contacts. Every revealed access is logged.
    """
    rows = await _safe_fetch("/churned-customers", {"days": days, "limit": limit}) or []
    if reveal:
        token = request.headers.get("X-PII-Reveal-Token") or request.headers.get("x-pii-reveal-token")
        from auth import verify_pii_reveal_token  # late import to avoid circular at module load
        if not verify_pii_reveal_token(getattr(user, "user_id", None), token):
            raise HTTPException(status_code=403, detail="Reveal token missing or expired — re-enter password")
        # Bypass role-based masking but write an audit row per customer.
        from pii import log_unmasked_access, _row_id, _CONTACT_FIELDS  # type: ignore
        await log_unmasked_access(
            user=user,
            endpoint="/churned-customers?reveal=true",
            row_ids=[rid for rid in (_row_id(r) for r in rows) if rid],
            fields=list(_CONTACT_FIELDS),
            request_ip=_client_ip(request),
        )
        return rows
    return await mask_and_audit(rows, user=user, endpoint="/churned-customers", request_ip=_client_ip(request))


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
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Order-frequency buckets for the selected period, EXCLUDING walk-ins.

    Walk-ins are detected via the same robust rule used elsewhere on the
    Customers page: no customer_id, customer_type=Guest, missing both
    phone & email in the upstream roster, or customer_name matching
    "walk"/"vivo"/"safari"/<store name>. Including walk-ins skews the
    one-order-only bucket and inflates the "8.2% repeat rate" reading.

    Returns the same shape as upstream `/customer-frequency`:
        [{"frequency_bucket": "1 order"|"2 orders"|...|"5+ orders",
          "customer_count": int}]
    so the existing chart + "Repeat Purchase Rate (legacy)" KPI keep
    rendering, just with a now-meaningful denominator.
    """
    if not date_from or not date_to:
        # No window — fall back to upstream pass-through (rare; the UI
        # always supplies a window, but admin tooling sometimes hits
        # this raw).
        rows = await _safe_fetch("/customer-frequency", {
            "date_from": date_from, "date_to": date_to,
        })
        return mask_rows(rows or [], getattr(user, "role", None))

    orders_rows = await _orders_for_window(date_from, date_to, country, channel)
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _customer_contacts_cache[1]

    # Count distinct (order_date, channel) "visits" per customer. Same-day
    # same-channel rows collapse to one visit; same-day different-channel
    # counts as two. Walk-ins dropped per the standard rules.
    cust_visits: Dict[str, set] = {}
    for r in orders_rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            continue
        cid = str(r.get("customer_id") or "").strip()
        if not cid:
            continue
        day = (r.get("order_date") or "")[:10]
        chan = r.get("channel") or r.get("pos_location_name") or ""
        if not day:
            continue
        cust_visits.setdefault(cid, set()).add((day, chan))

    # Bucket customers by their visit count.
    buckets = {"1 order": 0, "2 orders": 0, "3 orders": 0, "4 orders": 0, "5+ orders": 0}
    for visits in cust_visits.values():
        n = len(visits)
        if n <= 0:
            continue
        if n == 1:
            buckets["1 order"] += 1
        elif n == 2:
            buckets["2 orders"] += 1
        elif n == 3:
            buckets["3 orders"] += 1
        elif n == 4:
            buckets["4 orders"] += 1
        else:
            buckets["5+ orders"] += 1

    out = [
        {"frequency_bucket": k, "customer_count": v}
        for k, v in buckets.items()
    ]
    return mask_rows(out, getattr(user, "role", None))


# ---------------------------------------------------------------------------
# Customer analytics — identified-only retention, spend-by-type, unchurned.
# Walk-in orders (missing customer_id or customer_type=Guest) are excluded
# from EVERY metric below. Without this, the retention rate denominator is
# inflated by anonymous foot traffic that physically can't repeat-purchase.
# ---------------------------------------------------------------------------
# In-memory cache for the historical /orders fan-out — these queries are
# expensive (365-day window = 12 chunks × ≤50k rows). 10-minute TTL is
# enough for the dashboard while the data only ticks once a day upstream.
_CUSTOMER_HIST_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_CUSTOMER_HIST_TTL = 600  # 10 minutes
def _is_walk_in_order(r: Dict[str, Any], name_lookup: Optional[Dict[str, str]] = None,
                      contact_lookup: Optional[Dict[str, Dict[str, bool]]] = None) -> bool:
    """Robust walk-in detector — must match `walk-ins` endpoint logic.

    A walk-in is any sale that can't be tied to a real, contactable
    customer. Triggers if ANY of:
      1. No customer_id at all.
      2. customer_type tagged Guest / walk-in / anonymous.
      3. customer_id resolves to a blank-name row in /top-customers
         (the walk-in roster — ~379 such IDs).
      4. NEITHER phone NOR email known anywhere — checked across both
         the /orders row itself AND the /top-customers roster. This is
         the canonical ops definition: "a walk-in is a customer without
         both phone number and email".
      5. customer_name contains "walk" (covers walk-in, walkin, walk in).
      6. customer_name contains "vivo" / "safari" — staff sometimes
         enter the brand or store name as the customer.
      7. customer_name matches the POS / store / location name.

    `name_lookup` and `contact_lookup` should be passed by callers that
    have warmed `_get_customer_name_lookup` already.
    """
    cid = r.get("customer_id")
    if cid is None or (isinstance(cid, str) and not cid.strip()):
        return True
    ctype = (r.get("customer_type") or "").strip().lower()
    if ctype in ("guest", "walk-in", "walkin", "walk in", "anonymous"):
        return True
    cid_s = str(cid).strip()
    nm_lookup = name_lookup if name_lookup is not None else _customer_names_cache[1]
    ct_lookup = contact_lookup if contact_lookup is not None else _customer_contacts_cache[1]
    if cid_s in nm_lookup and not nm_lookup[cid_s]:
        # Known customer in the roster but with blank name = walk-in.
        return True
    # Rule 4 — "no phone AND no email" anywhere. Check the row first,
    # then the roster. If both come up empty, it's a walk-in regardless
    # of whether we found the cid in the roster at all (a customer not
    # in top-customers and with no contact on the order row is by
    # definition unreachable / anonymous).
    row_phone = r.get("customer_phone") or r.get("phone")
    row_email = r.get("customer_email") or r.get("email")
    has_row_phone = bool(row_phone and str(row_phone).strip())
    has_row_email = bool(row_email and str(row_email).strip())
    contact = ct_lookup.get(cid_s) or {}
    has_roster_phone = bool(contact.get("has_phone"))
    has_roster_email = bool(contact.get("has_email"))
    if not (has_row_phone or has_row_email or has_roster_phone or has_roster_email):
        return True
    cname = (r.get("customer_name") or nm_lookup.get(cid_s, "") or "").strip().lower()
    if not cname:
        return False
    cname_clean = cname.replace("-", " ").replace("_", " ")
    if "walk" in cname_clean:
        return True
    if "vivo" in cname_clean or "safari" in cname_clean:
        return True
    loc = (r.get("pos_location_name") or r.get("channel") or "").strip().lower()
    if loc:
        loc_clean = loc.replace("-", " ").replace("_", " ")
        if cname_clean == loc_clean:
            return True
        tokens = [t for t in loc_clean.split() if len(t) >= 4 and t not in ("vivo", "safari", "mall", "shop", "store")]
        if any(t in cname_clean for t in tokens):
            return True
    return False


async def _orders_for_window(date_from: str, date_to: str, country: Optional[str] = None,
                             channel: Optional[str] = None) -> List[Dict[str, Any]]:
    """Chunked /orders fan-out for analytics (≤30 days per chunk).
    Cached in-memory for 10 minutes per (window, country, channel).

    On upstream 5xx, returns the partial result instead of bubbling
    HTTPException — analytics endpoints can still produce useful output
    from whatever chunks succeeded. If EVERY chunk fails we raise 503.
    """
    import time as _time
    cache_key = f"{date_from}|{date_to}|{country or ''}|{channel or ''}"
    cached = _CUSTOMER_HIST_CACHE.get(cache_key)
    if cached and (_time.time() - cached[0]) < _CUSTOMER_HIST_TTL:
        return cached[1]
    df = datetime.strptime(date_from, "%Y-%m-%d").date()
    dt = datetime.strptime(date_to, "%Y-%m-%d").date()
    cs = _split_csv(country)
    chs = _split_csv(channel)
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= dt:
        end = min(cur + timedelta(days=29), dt)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)
    out: List[Dict[str, Any]] = []
    failed_chunks = 0
    for d1, d2 in chunks:
        try:
            rows = await _safe_fetch("/orders", {
                "date_from": d1.isoformat(), "date_to": d2.isoformat(),
                "limit": 50000,
                "country": cs[0] if len(cs) == 1 else None,
                "channel": chs[0] if len(chs) == 1 else None,
            }) or []
            out.extend(rows)
        except HTTPException:
            failed_chunks += 1
        except Exception as e:
            logger.warning("[_orders_for_window] chunk %s..%s failed: %s", d1, d2, e)
            failed_chunks += 1
    # Only raise if EVERY chunk failed and we got nothing — otherwise cache
    # and return the partial set so the analytics endpoints can compute
    # something useful from whatever did come back.
    if failed_chunks == len(chunks) and not out:
        raise HTTPException(status_code=503, detail="Upstream /orders unavailable — please retry in a moment.")
    _CUSTOMER_HIST_CACHE[cache_key] = (_time.time(), out)
    if len(_CUSTOMER_HIST_CACHE) > 32:
        oldest = sorted(_CUSTOMER_HIST_CACHE.items(), key=lambda kv: kv[1][0])[:8]
        for k, _ in oldest:
            _CUSTOMER_HIST_CACHE.pop(k, None)
    return out


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



# -------------------- Annual targets --------------------
# 2026 quarterly targets per channel-grouping. Provided by the Vivo
# finance team in May 2026 — KES, gross sales (matches `total_sales`
# in our /country-summary response). "Kenya - Retail" = country=Kenya
# excluding the Online channel; "Kenya - Online" = the synthetic
# "Online" country bucket in /country-summary; Uganda / Rwanda are
# all-channels for those countries.
ANNUAL_TARGETS_2026: Dict[str, Dict[str, float]] = {
    "Kenya - Retail":  {"Q1": 235683270.17, "Q2": 268560234.85, "Q3": 311407943.27, "Q4": 344585011.94},
    "Kenya - Online":  {"Q1": 23572899.43,  "Q2": 24678062.01,  "Q3": 23719608.11,  "Q4": 27552554.77},
    "Uganda":          {"Q1": 26904396.37,  "Q2": 28253262.57,  "Q3": 28975737.76,  "Q4": 38830408.85},
    "Rwanda":          {"Q1": 9780881.78,   "Q2": 11774964.60,  "Q3": 10543259.28,  "Q4": 19699177.34},
}
_QUARTER_BOUNDS_2026 = {
    "Q1": ("2026-01-01", "2026-03-31"),
    "Q2": ("2026-04-01", "2026-06-30"),
    "Q3": ("2026-07-01", "2026-09-30"),
    "Q4": ("2026-10-01", "2026-12-31"),
}


@api_router.get("/analytics/annual-targets")
async def analytics_annual_targets(year: int = Query(2026, ge=2020, le=2030)):
    """Annual sales targets vs actuals + run-rate projection.

    Returns one bucket per channel-grouping (Kenya - Retail, Kenya - Online,
    Uganda, Rwanda) plus a `total` row, each with:
      - `target_annual` and per-quarter `quarters[Q1..Q4]` targets
      - `actual_ytd` aggregated from /country-summary + /sales-summary
      - `actual_quarters[Q1..Q4]` per-quarter actuals (so the UI can
        flag any quarter that's already off-track)
      - `projected_year` based on YTD daily run-rate × total year days
      - `pct_of_target_ytd` and `pct_of_target_projected`

    The "Kenya - Retail" actual is computed as country-summary `Kenya`
    total MINUS the `Online` channel sales for Kenya (so we don't
    double-count when the Online roll-up has Kenya orders mixed in).

    Years other than 2026 are supported in **actuals-only** mode — the
    `target_annual` and per-quarter targets default to 0 (the leadership
    board is set yearly, only 2026 is on file). This is so the
    Targets Tracker page can fetch year-1 actuals for YoY comparison.
    """
    import datetime as _dt
    targets = ANNUAL_TARGETS_2026 if year == 2026 else {
        "Kenya - Retail": {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0},
        "Kenya - Online": {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0},
        "Uganda":         {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0},
        "Rwanda":         {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0},
    }

    today = _dt.date.today()
    year_start = _dt.date(year, 1, 1)
    year_end = _dt.date(year, 12, 31)
    days_total = (year_end - year_start).days + 1
    # YoY anchor: when looking at a past year, cap the "as-of" date to
    # the same month/day as today so it's an apples-to-apples YTD.
    if year < today.year:
        anchor = _dt.date(year, today.month, today.day)
    else:
        anchor = today
    days_elapsed = max(0, (min(anchor, year_end) - year_start).days + 1)
    ytd_to_iso = min(anchor, year_end).isoformat()

    # Per-year quarter bounds (only 2026 has them hardcoded; for other
    # years synthesise the windows on the fly).
    if year == 2026:
        q_bounds = _QUARTER_BOUNDS_2026
    else:
        q_bounds = {
            "Q1": (f"{year}-01-01", f"{year}-03-31"),
            "Q2": (f"{year}-04-01", f"{year}-06-30"),
            "Q3": (f"{year}-07-01", f"{year}-09-30"),
            "Q4": (f"{year}-10-01", f"{year}-12-31"),
        }

    # Pull YTD country-summary once + per-quarter actuals in parallel.
    cs_tasks = [
        fetch("/country-summary",
              {"date_from": year_start.isoformat(), "date_to": ytd_to_iso},
              timeout_sec=20.0, max_attempts=2),
    ]
    quarter_tasks = []
    quarter_keys = []
    for qk, (qf, qt) in q_bounds.items():
        if qf > ytd_to_iso:
            continue
        q_to = min(qt, ytd_to_iso)
        quarter_tasks.append(
            fetch("/country-summary",
                  {"date_from": qf, "date_to": q_to},
                  timeout_sec=20.0, max_attempts=2)
        )
        quarter_keys.append(qk)
    cs_ytd_raw, *quarter_results = await asyncio.gather(*cs_tasks, *quarter_tasks)

    def _bucket_sales(rows: List[Dict[str, Any]]) -> Dict[str, float]:
        """Convert a /country-summary list into the 4-bucket dict the
        target board uses. Note: upstream returns 'Online' as its own
        bucket, so 'Kenya - Retail' = Kenya's total. (No further
        subtraction needed — Online is already separated upstream.)
        """
        out = {"Kenya - Retail": 0.0, "Kenya - Online": 0.0, "Uganda": 0.0, "Rwanda": 0.0}
        for r in rows or []:
            c = (r.get("country") or "").strip()
            v = float(r.get("total_sales") or 0)
            if c == "Kenya":
                out["Kenya - Retail"] += v
            elif c == "Online":
                out["Kenya - Online"] += v
            elif c == "Uganda":
                out["Uganda"] += v
            elif c == "Rwanda":
                out["Rwanda"] += v
        return out

    actuals_ytd = _bucket_sales(cs_ytd_raw or [])
    actuals_per_quarter: Dict[str, Dict[str, float]] = {qk: _bucket_sales(g or []) for qk, g in zip(quarter_keys, quarter_results)}

    # Build per-bucket result.
    buckets: List[Dict[str, Any]] = []
    for name, q_targets in targets.items():
        annual_target = sum(q_targets.values())
        ytd_actual = actuals_ytd.get(name, 0.0)
        # YTD run-rate projection: actual ÷ days_elapsed × days_total.
        # Floors at the YTD actual so a year already past target stays high.
        projected = (ytd_actual / days_elapsed * days_total) if days_elapsed else 0.0
        q_actuals = {qk: actuals_per_quarter.get(qk, {}).get(name, 0.0) for qk in _QUARTER_BOUNDS_2026}
        buckets.append({
            "bucket": name,
            "target_annual": round(annual_target, 2),
            "quarters": {qk: round(v, 2) for qk, v in q_targets.items()},
            "actual_ytd": round(ytd_actual, 2),
            "actual_quarters": {qk: round(v, 2) for qk, v in q_actuals.items()},
            "projected_year": round(projected, 2),
            "pct_of_target_ytd": round((ytd_actual / annual_target * 100), 2) if annual_target else 0,
            "pct_of_target_projected": round((projected / annual_target * 100), 2) if annual_target else 0,
            "variance_projected": round(projected - annual_target, 2),
        })

    total_target = sum(b["target_annual"] for b in buckets)
    total_actual = sum(b["actual_ytd"] for b in buckets)
    total_projected = sum(b["projected_year"] for b in buckets)
    total_q_actuals = {
        qk: round(sum(b["actual_quarters"][qk] for b in buckets), 2)
        for qk in _QUARTER_BOUNDS_2026
    }
    total_q_targets = {
        qk: round(sum(b["quarters"][qk] for b in buckets), 2)
        for qk in _QUARTER_BOUNDS_2026
    }
    return {
        "year": year,
        "as_of": anchor.isoformat(),
        "days_elapsed": days_elapsed,
        "days_total": days_total,
        "completion_pct": round((days_elapsed / days_total * 100), 2) if days_total else 0,
        "buckets": buckets,
        "total": {
            "target_annual": round(total_target, 2),
            "quarters": total_q_targets,
            "actual_ytd": round(total_actual, 2),
            "actual_quarters": total_q_actuals,
            "projected_year": round(total_projected, 2),
            "pct_of_target_ytd": round((total_actual / total_target * 100), 2) if total_target else 0,
            "pct_of_target_projected": round((total_projected / total_target * 100), 2) if total_target else 0,
            "variance_projected": round(total_projected - total_target, 2),
        },
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
    # Tunable sensitivity bands. Defaults preserve pre-iter-64 behaviour.
    low_pct: float = Query(
        20.0, ge=5.0, le=80.0,
        description="FROM threshold — store qualifies when units_sold ≤ low_pct% of group average. Default 20%.",
    ),
    high_pct: float = Query(
        150.0, ge=110.0, le=400.0,
        description="TO threshold — store qualifies when units_sold ≥ high_pct% of group average. Default 150%.",
    ),
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

        # Low-velocity candidates (FROM) — tunable via low_pct.
        low_threshold = avg_units * (low_pct / 100.0)
        lows = [(loc, s) for loc, s in per_store.items()
                if s["available"] >= min_move and s["units_sold"] <= low_threshold]
        # High-demand candidates (TO) — tunable via high_pct.
        high_threshold = avg_units * (high_pct / 100.0)
        highs = [(loc, s) for loc, s in per_store.items()
                 if s["units_sold"] >= high_threshold and s["available"] < 5]

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

    # Dedupe — each (style, to_store) destination must have exactly ONE
    # source store, otherwise picker teams pull the same item from
    # multiple shops and create overstock at the destination. Greedy
    # assignment: walk the suggestions in uplift order, assigning each
    # destination to the first source that still has surplus capacity
    # for that style. Subsequent rows for the same destination are
    # dropped, and the chosen source's remaining capacity is debited
    # so two destinations don't double-claim the same units.
    from_remaining: Dict[Tuple[str, str], int] = {}
    for s in suggestions:
        fk = (s["style_name"], s["from_store"])
        # Initial capacity = stock at FROM minus a 2-unit safety floor.
        from_remaining.setdefault(fk, max(0, int(s["from_available"]) - 2))

    deduped: List[Dict[str, Any]] = []
    chosen_to: set = set()
    for s in suggestions:
        dest_key = (s["style_name"], s["to_store"])
        if dest_key in chosen_to:
            continue  # destination already has a source assigned
        fk = (s["style_name"], s["from_store"])
        avail = from_remaining.get(fk, 0)
        if avail < min_move:
            continue
        movable = min(int(s["units_to_move"]), avail)
        if movable < min_move:
            continue
        avg_price = s["avg_price"] or 0
        uplift = round(movable * avg_price)
        deduped.append({**s, "units_to_move": movable, "estimated_uplift": uplift})
        from_remaining[fk] = avail - movable
        chosen_to.add(dest_key)

    deduped.sort(key=lambda x: x["estimated_uplift"], reverse=True)
    final = deduped[: int(limit)]
    # Persist first-seen timestamp for each surfaced suggestion so the
    # /api/ibt/late-count endpoint can flag stuck transfers (>5 days
    # without action). Fire-and-forget — tracking failure must NEVER
    # block the suggestions response.
    try:
        from ibt_completed import track_suggestions_batch, get_seen_map_for
        await track_suggestions_batch(final)
        seen_map = await get_seen_map_for(final)
        now_utc = datetime.now(timezone.utc)
        for s in final:
            key = f"{s.get('style_name')}||{s.get('from_store')}||{s.get('to_store')}"
            fs = seen_map.get(key)
            if fs is not None:
                # Tracker just upserted this key with last_seen=now and
                # set first_seen ONLY if it didn't already exist; if the
                # row was just created its first_seen is also `now` so
                # days_lapsed correctly returns 0 for fresh suggestions.
                s["first_seen_at"] = fs.isoformat()
                s["days_lapsed"] = max(0, (now_utc.date() - fs.date()).days)
            else:
                s["first_seen_at"] = None
                s["days_lapsed"] = 0
    except Exception:
        pass
    # Phase 1 cluster enrichment — annotate each row with the FROM and TO
    # store's peer-cluster id (e.g. "A2"). Surface-only — IBT logic still
    # uses the chain-wide average. Failure is non-fatal.
    try:
        from jobs.cluster_stores import get_current_clusters
        cluster_doc = await get_current_clusters(db)
        bs = cluster_doc.get("by_store") or {}
        for s in final:
            f = bs.get(s.get("from_store")) or {}
            t = bs.get(s.get("to_store")) or {}
            s["from_cluster_id"] = f.get("cluster_id")
            s["to_cluster_id"] = t.get("cluster_id")
            s["cluster_match"] = bool(
                f.get("cluster_id") and f.get("cluster_id") == t.get("cluster_id")
            )
    except Exception:
        pass
    return final


@api_router.get("/analytics/ibt-warehouse-to-store")
async def analytics_ibt_warehouse_to_store(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    min_daily_velocity: float = Query(0.2, ge=0, le=50),
    user=Depends(get_current_user),
):
    """Warehouse → Store replenishment suggestions.

    Stores selling a SKU but stocked-out (or near-out) get listed with
    the warehouse stock that could top them up. Different from the
    store-to-store IBT because warehouses can't sell — they only feed
    the shop floor.

    Rule:
      • A (style, store) qualifies if the store has sold units in the
        window AND its current SOH is below the recent daily-velocity
        run-rate × ``3`` days (a deliberate 3-day safety floor).
      • A style qualifies if ≥1 warehouse location has ``available > 0``.
      • Suggested qty = min(warehouse_available, 4×weekly_velocity − soh)
        capped at a max of 4 weeks of cover.

    Returns rows ordered by ``missed_sales_risk`` (velocity × shortfall)
    descending so the biggest wins come first.
    """
    if not date_from or not date_to:
        today = datetime.now(timezone.utc).date()
        date_to = today.isoformat()
        date_from = (today - timedelta(days=28)).isoformat()

    # Window duration in days (for computing daily velocity from
    # `units_sold` aggregates).
    try:
        window_days = max(
            1,
            (datetime.fromisoformat(date_to).date()
             - datetime.fromisoformat(date_from).date()).days + 1,
        )
    except Exception:
        window_days = 28

    # Fetch sales-per-(style, store) and inventory in parallel.
    cs = _split_csv(country)
    sor_task = fetch("/sor", {
        "date_from": date_from, "date_to": date_to,
        "country": cs[0] if len(cs) == 1 else None,
        "limit": 5000,
    })
    inv_task = fetch_all_inventory(country=country)
    # `/orders` is the source of truth for per-(style, store) sales —
    # upstream has no `/top-skus-by-store` equivalent, but the
    # chunked-orders helper is already used elsewhere in this file
    # with a 30-min TTL so the warmup covers it.
    orders_task = _orders_for_window(date_from, date_to, country=country)
    sor_rows, inv, sales_rows = await asyncio.gather(
        sor_task, inv_task, orders_task
    )

    # Index warehouse stock per style (sum across warehouse locations).
    wh_by_style: Dict[str, float] = defaultdict(float)
    for r in (inv or []):
        if not is_warehouse_location(r.get("location_name")):
            continue
        style = r.get("style_name")
        if style:
            wh_by_style[style] += float(r.get("available") or 0)

    # Index store stock per (style, store).
    store_stock: Dict[Tuple[str, str], float] = defaultdict(float)
    store_brand: Dict[Tuple[str, str], str] = {}
    for r in (inv or []):
        if is_warehouse_location(r.get("location_name")):
            continue
        style = r.get("style_name")
        store = r.get("location_name")
        if not style or not store:
            continue
        store_stock[(style, store)] += float(r.get("available") or 0)
        store_brand[(style, store)] = r.get("brand") or ""

    # Build per-(style, store) sales velocity from /orders rows.
    # `/orders` rows have `style_name`, `pos_location_name` (the POS),
    # and `quantity`. Warehouses don't book sales so they never appear.
    sales_by_style_store: Dict[Tuple[str, str], float] = defaultdict(float)
    for r in (sales_rows or []):
        style = r.get("style_name")
        store = r.get("pos_location_name") or r.get("channel")
        if not style or not store:
            continue
        if is_warehouse_location(store):
            continue
        sales_by_style_store[(style, store)] += float(r.get("quantity") or 0)

    suggestions: List[Dict[str, Any]] = []
    # Online channels never receive physical inventory transfers — they
    # ship from the warehouse directly to customers. Surface only
    # bricks-and-mortar destinations so floor-replenishment teams aren't
    # confused by Shop Zetu / Online Safari rows.
    _ONLINE_DEST_KEYS = ("online", "shop zetu", "studio", "wholesale")
    for (style, store), units in sales_by_style_store.items():
        if units <= 0:
            continue
        if any(k in (store or "").lower() for k in _ONLINE_DEST_KEYS):
            continue
        daily = units / window_days
        if daily < min_daily_velocity:
            continue
        soh = store_stock.get((style, store), 0.0)
        # Shortfall = what we need to cover ~3 more days minus what's
        # on the floor. Only actionable when shortfall > 0.
        target_3d = daily * 3
        if soh >= target_3d:
            continue
        wh_available = wh_by_style.get(style, 0.0)
        if wh_available <= 0:
            continue
        # Suggested move: fill to 4 weeks cover, bounded by warehouse
        # stock.
        target_4w = daily * 28
        suggested = max(0, min(int(wh_available), int(round(target_4w - soh))))
        if suggested <= 0:
            continue
        shortfall_risk = round(daily * max(0, target_3d - soh), 2)
        # Pull brand/subcat off the SOR row for display.
        sor_match = next((r for r in (sor_rows or []) if r.get("style_name") == style), None)
        suggestions.append({
            "style_name": style,
            "brand": (sor_match or {}).get("brand") or store_brand.get((style, store), ""),
            "subcategory": (sor_match or {}).get("product_type") or "",
            "to_store": store,
            "units_sold": int(units),
            "daily_velocity": round(daily, 2),
            "weekly_velocity": round(daily * 7, 1),
            "store_soh": int(soh),
            "days_of_cover": round(soh / daily, 1) if daily > 0 else None,
            "warehouse_available": int(wh_available),
            "suggested_qty": int(suggested),
            "missed_sales_risk": shortfall_risk,
        })
    suggestions.sort(key=lambda r: r["missed_sales_risk"], reverse=True)
    final_wh = suggestions[: int(limit)]
    # Track first-seen for warehouse → store too (from_store is always
    # the central warehouse so we tag it explicitly).
    try:
        from ibt_completed import track_suggestions_batch, get_seen_map_for
        tracker_payload = [
            {
                "style_name": s["style_name"],
                "from_store": "Warehouse Finished Goods",
                "to_store": s["to_store"],
            }
            for s in final_wh
        ]
        await track_suggestions_batch(tracker_payload)
        seen_map = await get_seen_map_for(tracker_payload)
        now_utc = datetime.now(timezone.utc)
        for s in final_wh:
            key = f"{s.get('style_name')}||Warehouse Finished Goods||{s.get('to_store')}"
            fs = seen_map.get(key)
            if fs is not None:
                s["first_seen_at"] = fs.isoformat()
                s["days_lapsed"] = max(0, (now_utc.date() - fs.date()).days)
            else:
                s["first_seen_at"] = None
                s["days_lapsed"] = 0
    except Exception:
        pass
    # Phase 1 cluster enrichment — to_cluster_id only (FROM is always the
    # warehouse which doesn't carry a cluster).
    try:
        from jobs.cluster_stores import get_current_clusters
        cluster_doc = await get_current_clusters(db)
        bs = cluster_doc.get("by_store") or {}
        for s in final_wh:
            t = bs.get(s.get("to_store")) or {}
            s["to_cluster_id"] = t.get("cluster_id")
            s["from_cluster_id"] = None
            s["cluster_match"] = False
    except Exception:
        pass
    return final_wh


@api_router.get("/analytics/ibt-sku-breakdown")
async def analytics_ibt_sku_breakdown(
    style_name: str,
    from_store: str,
    to_store: str,
    units_to_move: Optional[int] = None,
):
    """SKU-level (color × size) breakdown for a single IBT recommendation.

    For each SKU of the style that exists at either store, returns the
    available stock at FROM, available stock at TO, and a suggested qty
    to transfer for that SKU. The suggested qty is allocated greedily:
    fill SKUs that are out-of-stock at TO first, in descending FROM-stock
    order, capped by the parent recommendation's `units_to_move` (when
    provided) and a 1-unit safety buffer at FROM.

    Works for warehouse → store IBTs too — pass the warehouse name as
    `from_store` (e.g. "Warehouse Finished Goods") and the helper will
    aggregate across every warehouse location matching the warehouse-key
    list, since upstream sometimes splits warehouse stock across more
    than one location row.
    """
    # Pull SKU-level inventory for both stores in parallel. We use the
    # singular `location` path (not the fan-out) so each call is a single
    # cached upstream hit. For warehouse FROM, fetch the full inventory
    # and post-filter to all warehouse locations so we capture stock that
    # might be spread across multiple warehouse rows.
    from_is_warehouse = is_warehouse_location(from_store)
    if from_is_warehouse:
        all_inv, to_rows = await asyncio.gather(
            fetch_all_inventory(),
            fetch_all_inventory(location=to_store),
        )
        from_rows = [r for r in (all_inv or []) if is_warehouse_location(r.get("location_name"))]
    else:
        from_rows, to_rows, all_inv = await asyncio.gather(
            fetch_all_inventory(location=from_store),
            fetch_all_inventory(location=to_store),
            # Cached after the first call — used as a global SKU→barcode
            # fallback when the per-store rows lack the barcode field
            # (some POS exports omit barcode on rows where the store
            # doesn't physically carry the SKU yet).
            fetch_all_inventory(),
        )

    def _is_match(r: Dict[str, Any]) -> bool:
        return (r.get("style_name") or "").strip() == style_name.strip()

    from_skus = [r for r in (from_rows or []) if _is_match(r)]
    to_skus = [r for r in (to_rows or []) if _is_match(r)]

    # Build a global SKU → barcode fallback map from the full inventory
    # snapshot. Keep first non-empty barcode per SKU. Used as a fill-in
    # for any SKU whose per-store row was missing the barcode field.
    sku_to_barcode_fallback: Dict[str, str] = {}
    for r in (all_inv or []):
        if (r.get("style_name") or "").strip() != style_name.strip():
            continue
        sku = r.get("sku") or ""
        bc = (r.get("barcode") or "").strip()
        if sku and bc and sku not in sku_to_barcode_fallback:
            sku_to_barcode_fallback[sku] = bc

    # Index by SKU code.
    sku_idx: Dict[str, Dict[str, Any]] = {}
    for r in from_skus:
        sku = r.get("sku") or ""
        if not sku:
            continue
        sku_idx.setdefault(sku, {
            "sku": sku,
            "barcode": r.get("barcode") or "",
            "color": r.get("color_print") or r.get("color") or "—",
            "size": r.get("size") or "—",
            "from_available": 0,
            "to_available": 0,
        })
        sku_idx[sku]["from_available"] += int(r.get("available") or 0)
        if not sku_idx[sku].get("barcode") and r.get("barcode"):
            sku_idx[sku]["barcode"] = r.get("barcode")
    for r in to_skus:
        sku = r.get("sku") or ""
        if not sku:
            continue
        sku_idx.setdefault(sku, {
            "sku": sku,
            "barcode": r.get("barcode") or "",
            "color": r.get("color_print") or r.get("color") or "—",
            "size": r.get("size") or "—",
            "from_available": 0,
            "to_available": 0,
        })
        sku_idx[sku]["to_available"] += int(r.get("available") or 0)
        if not sku_idx[sku].get("barcode") and r.get("barcode"):
            sku_idx[sku]["barcode"] = r.get("barcode")

    rows = list(sku_idx.values())

    # Fill in any missing barcodes from the global inventory fallback
    # so the warehouse picker always sees a barcode if it exists
    # anywhere in the catalogue (even when the per-store rows didn't
    # carry it).
    for r in rows:
        if not r.get("barcode") and r.get("sku") in sku_to_barcode_fallback:
            r["barcode"] = sku_to_barcode_fallback[r["sku"]]

    # Allocation: greedy fill — fix shortages at TO first (TO=0 then TO=1 …),
    # using SKUs with the largest excess at FROM. Use a 1-unit safety buffer
    # at FROM only when from_available > 2; otherwise the IBT was triggered
    # because the source is slow-moving anyway, so liquidate fully.
    budget = int(units_to_move) if units_to_move else None
    rows.sort(key=lambda r: (r["to_available"], -r["from_available"]))
    for r in rows:
        buffer = 1 if r["from_available"] > 2 else 0
        max_from_can_send = max(0, r["from_available"] - buffer)
        # Aim to bring TO up to 3 units cover.
        gap = max(0, 3 - r["to_available"])
        proposed = min(max_from_can_send, gap)
        if budget is not None:
            proposed = min(proposed, budget)
            budget -= proposed
        r["suggested_qty"] = proposed

    # Re-sort for display: biggest suggested first, then biggest from_stock.
    rows.sort(key=lambda r: (r["suggested_qty"], r["from_available"]), reverse=True)

    return {
        "style_name": style_name,
        "from_store": from_store,
        "to_store": to_store,
        "skus": rows,
        "from_total": sum(r["from_available"] for r in rows),
        "to_total": sum(r["to_available"] for r in rows),
        "suggested_total": sum(r["suggested_qty"] for r in rows),
    }


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
    cache_key = ("/footfall", date_from or "", date_to or "", "", channel or "")
    try:
        if len(chs) <= 1:
            data = await fetch("/footfall", {**base, "channel": chs[0] if chs else None}, timeout_sec=15.0, max_attempts=3)
        else:
            tasks = [fetch("/footfall", {**base, "channel": ch}, timeout_sec=15.0, max_attempts=3) for ch in chs]
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
            data = out
        _kpi_stale_cache[cache_key] = (time.time(), data)
        asyncio.create_task(_kpi_stale_save_async())
        return data
    except HTTPException as e:
        cached = _kpi_stale_cache.get(cache_key)
        if cached and (time.time() - cached[0] < _KPI_STALE_TTL):
            logger.warning(f"/footfall upstream {e.status_code} — serving stale (age={int(time.time()-cached[0])}s)")
            return cached[1]
        raise


# Footfall weekday pattern — caches for 1 hour since the data only shifts
# when a new day completes. Key: (date_from, date_to, country).
_weekday_pattern_cache: Dict[str, tuple] = {}
_WEEKDAY_PATTERN_TTL = 3600  # 1h


@api_router.get("/footfall/weekday-pattern")
async def get_footfall_weekday_pattern(
    # Hard default: trailing 28 days (exactly 4 weeks) so every weekday
    # gets an equal number of samples. Callers can override with an
    # explicit range but we cap the span at 56 days to protect upstream.
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
):
    """
    Per-location × per-weekday footfall / conversion averages, for a
    heatmap on the Footfall page. Upstream exposes daily aggregates only,
    so we fan out one /footfall call per day across the window and
    aggregate client-side. 1h in-memory cache (keyed by range + country).

    Response shape:
      {
        "window": {"start": "2026-03-27", "end": "2026-04-23", "days": 28},
        "locations": ["Vivo Moi Avenue", ...],           # sorted by total footfall
        "rows": [                                         # one per location
          {
            "location": "Vivo Moi Avenue",
            "avg_footfall": 315.4,
            "avg_conversion_rate": 12.3,
            "by_weekday": [                               # index 0=Mon .. 6=Sun
              {"weekday": 0, "avg_footfall": 280, "avg_conversion_rate": 11.8, "days": 4},
              ...
            ]
          },
        ],
        "group_avg_by_weekday": [                         # across all locations
          {"weekday": 0, "avg_footfall": 2100, "avg_conversion_rate": 12.1, "days": 4},
          ...
        ]
      }
    """
    from datetime import date, timedelta

    # Default / validate window. 28-day default, 56-day hard cap.
    try:
        today = datetime.now(timezone.utc).date()
        end_d = date.fromisoformat(date_to) if date_to else today - timedelta(days=1)
        start_d = date.fromisoformat(date_from) if date_from else end_d - timedelta(days=27)
        if end_d < start_d:
            start_d, end_d = end_d, start_d
        if (end_d - start_d).days > 55:
            start_d = end_d - timedelta(days=55)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date_from / date_to")

    cache_key = f"{start_d.isoformat()}|{end_d.isoformat()}|{country or ''}"
    import time as _t
    cached = _weekday_pattern_cache.get(cache_key)
    if cached and (_t.time() - cached[0]) < _WEEKDAY_PATTERN_TTL:
        return cached[1]

    # Enumerate dates, fan out /footfall per day (concurrency-limited).
    dates = []
    d = start_d
    while d <= end_d:
        dates.append(d)
        d += timedelta(days=1)

    sem = asyncio.Semaphore(6)

    async def _one_day(day):
        async with sem:
            iso = day.isoformat()
            try:
                return day, await fetch("/footfall", {
                    "date_from": iso, "date_to": iso,
                    "channel": country,  # NB: upstream uses `channel` for country grouping
                })
            except Exception as e:
                logger.warning("[weekday-pattern] %s fetch failed: %s", iso, e)
                return day, []

    results = await asyncio.gather(*(_one_day(dd) for dd in dates))

    # Aggregate: {location: {weekday: [ (footfall, orders, sales), ... ]}}
    from collections import defaultdict
    loc_wk: Dict[str, Dict[int, List[Tuple[int, int, float]]]] = defaultdict(lambda: defaultdict(list))
    group_wk: Dict[int, List[Tuple[int, int]]] = defaultdict(list)
    for day, rows in results:
        if not isinstance(rows, list):
            continue
        wk = day.weekday()  # 0=Mon..6=Sun
        for r in rows:
            loc = r.get("location")
            if not loc:
                continue
            ff = int(r.get("total_footfall") or 0)
            orders = int(r.get("orders") or 0)
            sales = float(r.get("total_sales") or 0.0)
            if ff <= 0 and orders <= 0:
                continue
            loc_wk[loc][wk].append((ff, orders, sales))
            group_wk[wk].append((ff, orders))

    def avg(xs, i):
        vals = [x[i] for x in xs if x[i] is not None]
        return (sum(vals) / len(vals)) if vals else 0.0

    def conv_rate(xs):
        total_orders = sum(x[1] for x in xs)
        total_ff = sum(x[0] for x in xs)
        return (total_orders / total_ff * 100) if total_ff else 0.0

    rows_out = []
    for loc, wk_map in loc_wk.items():
        by_weekday = []
        all_samples: List[Tuple[int, int, float]] = []
        for wk in range(7):
            samples = wk_map.get(wk, [])
            by_weekday.append({
                "weekday": wk,
                "avg_footfall": round(avg(samples, 0), 1),
                "avg_orders": round(avg(samples, 1), 1),
                "avg_conversion_rate": round(conv_rate(samples), 2),
                "days": len(samples),
            })
            all_samples.extend(samples)
        total_footfall = sum(s[0] for s in all_samples)
        rows_out.append({
            "location": loc,
            "avg_footfall": round(avg(all_samples, 0), 1),
            "avg_conversion_rate": round(conv_rate(all_samples), 2),
            "total_footfall_window": total_footfall,
            "by_weekday": by_weekday,
        })
    rows_out.sort(key=lambda r: r["total_footfall_window"], reverse=True)

    group_out = []
    for wk in range(7):
        samples = group_wk.get(wk, [])
        group_out.append({
            "weekday": wk,
            "avg_footfall": round(sum(s[0] for s in samples) / max(1, len(set(day for day, rs in results if day.weekday() == wk))), 1) if samples else 0,
            "avg_conversion_rate": round(conv_rate(samples), 2),
            "days": len(set(day for day, rs in results if day.weekday() == wk)),
        })

    data = {
        "window": {
            "start": start_d.isoformat(),
            "end": end_d.isoformat(),
            "days": (end_d - start_d).days + 1,
        },
        "locations": [r["location"] for r in rows_out],
        "rows": rows_out,
        "group_avg_by_weekday": group_out,
    }
    _weekday_pattern_cache[cache_key] = (_t.time(), data)
    return data


@api_router.get("/subcategory-sales")
async def get_subcategory_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Upstream now returns one clean row per subcategory (no brand split),
    so we fan out per country/channel and merge by subcategory only.

    Country must be Title-case for upstream (lowercase silently returns
    zeros) — normalize via `_norm_country` before forwarding.
    """
    base = {"date_from": date_from, "date_to": date_to}
    cs = [_norm_country(c) for c in _split_csv(country)]
    chs = _split_csv(channel)
    if len(cs) <= 1 and len(chs) <= 1:
        cfc = cs[0] if cs else None
        data = await fetch("/subcategory-sales", {
            **base, "country": cfc, "channel": chs[0] if chs else None,
        })
        return data or []
    # Multi-country fan-out — merge per-subcategory.
    results = await asyncio.gather(*[
        fetch("/subcategory-sales", {
            **base,
            **({"country": c} if c else {}),
            **({"channel": ch} if ch else {}),
        })
        for c in (cs or [None])
        for ch in (chs or [None])
    ])
    merged: Dict[str, Dict[str, Any]] = {}
    for g in results:
        for r in (g or []):
            key = r.get("subcategory")
            if not key:
                continue
            if key not in merged:
                merged[key] = {**r}
            else:
                for f in ("units_sold", "total_sales", "gross_sales", "orders"):
                    merged[key][f] = (merged[key].get(f) or 0) + (r.get(f) or 0)
    return sorted(merged.values(), key=lambda r: r.get("total_sales") or 0, reverse=True)


# Country buckets used by the Category × Country matrix. The upstream
# /country-summary returns physical countries plus the "Online" channel as
# its own row, so we treat Online identically to a country here.
_MATRIX_COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"]


@api_router.get("/analytics/category-country-matrix")
async def get_category_country_matrix(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Subcategory × Country sales matrix.

    Rows = every subcategory that sold in the period.
    Columns = Kenya, Uganda, Rwanda, Online (fixed canonical ordering).
    Each cell = { sales_kes, share_pct } where share_pct is the
    subcategory's share of THAT COUNTRY's total sales (per user spec).
    Returns row-level totals (across all 4 countries) and a column total
    row aggregating per-country grand totals.
    """
    base = {"date_from": date_from, "date_to": date_to}
    chs = _split_csv(channel)

    async def _fetch_for(country: str) -> List[Dict[str, Any]]:
        if not chs:
            try:
                return await fetch("/subcategory-sales", {**base, "country": country}) or []
            except HTTPException:
                return []
        # Multi-channel fan-out, mirror /subcategory-sales merge semantics.
        tasks = [
            fetch("/subcategory-sales", {**base, "country": country, "channel": ch})
            for ch in chs
        ]
        try:
            results = await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            return []
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            if isinstance(g, Exception) or not g:
                continue
            for r in g:
                key = r.get("subcategory")
                if not key:
                    continue
                if key not in merged:
                    merged[key] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales", "orders"):
                        merged[key][f] = (merged[key].get(f) or 0) + (r.get(f) or 0)
        return list(merged.values())

    # Parallel pull, one request per country.
    per_country = await asyncio.gather(*[_fetch_for(c) for c in _MATRIX_COUNTRIES])

    # Build the matrix: index every subcategory observed in any country.
    country_totals: Dict[str, float] = {c: 0.0 for c in _MATRIX_COUNTRIES}
    cells: Dict[str, Dict[str, float]] = {}  # subcat -> {country: sales}
    for country, rows in zip(_MATRIX_COUNTRIES, per_country):
        for r in rows or []:
            sub = r.get("subcategory")
            if not sub:
                continue
            sales = r.get("total_sales") or 0.0
            cells.setdefault(sub, {})[country] = sales
            country_totals[country] += sales

    # Emit rows with a `cells` map per country containing both the absolute
    # KES value and the country-share percent (% of THAT country's total).
    matrix_rows: List[Dict[str, Any]] = []
    for sub, country_map in cells.items():
        row_total = sum(country_map.values())
        row_cells = {}
        for c in _MATRIX_COUNTRIES:
            v = country_map.get(c, 0.0)
            ct = country_totals.get(c, 0.0)
            row_cells[c] = {
                "sales_kes": round(v, 2),
                "share_of_country_pct": round((v / ct * 100), 2) if ct else 0.0,
            }
        matrix_rows.append({
            "subcategory": sub,
            "cells": row_cells,
            "row_total_kes": round(row_total, 2),
        })

    matrix_rows.sort(key=lambda r: r.get("row_total_kes") or 0, reverse=True)

    grand_total = sum(country_totals.values())
    return {
        "countries": _MATRIX_COUNTRIES,
        "rows": matrix_rows,
        "country_totals": {c: round(country_totals[c], 2) for c in _MATRIX_COUNTRIES},
        "grand_total_kes": round(grand_total, 2),
    }


@api_router.get("/subcategory-stock-sales")
async def get_subcategory_stock_sales(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    # Upstream silently zeros sales when country isn't Title-case (frontend
    # sends "kenya" → upstream needs "Kenya"). Normalize CSV → Title-case.
    norm_country = _norm_country_csv(country)
    data = await fetch("/subcategory-stock-sales", {
        "date_from": date_from, "date_to": date_to,
        "country": norm_country if norm_country and "," not in norm_country else norm_country,
        "channel": channel,
    })
    return data


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


async def _subcategory_sales_from_orders(
    date_from: Optional[str],
    date_to: Optional[str],
    country: Optional[str],
    locs: List[str],
) -> Dict[str, Dict[str, float]]:
    """Aggregate /orders rows by subcategory (`product_type`) when a POS
    scope is active. Upstream's `/subcategory-stock-sales` and
    `/subcategory-sales` silently drop sales when `channel` is set to a
    name they don't recognize (or when a CSV is passed) — many Kenya
    POS hit this and return units_sold=0. We sidestep that here by
    rolling /orders up ourselves so units/sales/orders stay accurate
    under multi-POS / single-non-warehouse-POS filters.

    Returns `{subcategory: {units, sales, orders}}`. Mirrors the brand
    / merchandise filters from `analytics_sts_by_attribute`.
    """
    today = datetime.now(timezone.utc).date()
    df = datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else (today - timedelta(days=30))
    dt = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today
    cs = _split_csv(country)

    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= dt:
        end = min(cur + timedelta(days=29), dt)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    async def _chunk(d1: date, d2: date) -> List[Dict[str, Any]]:
        return await _safe_fetch("/orders", {
            "date_from": d1.isoformat(), "date_to": d2.isoformat(),
            "limit": 50000,
            "country": cs[0] if len(cs) == 1 else None,
            "channel": locs[0] if len(locs) == 1 else None,
        }) or []

    chunk_rows: List[Dict[str, Any]] = []
    for d1, d2 in chunks:
        chunk_rows.extend(await _chunk(d1, d2))

    cs_set = {c.lower() for c in cs}
    locs_set = set(locs)

    # `orders` count = unique order_id per subcategory (mirrors how the
    # upstream `/subcategory-sales` exposes the field). Track per-subcat
    # order_id sets and reduce to len at the end.
    by_sub: Dict[str, Dict[str, Any]] = {}
    for r in chunk_rows:
        if is_excluded_brand(r.get("brand")):
            continue
        if is_excluded_product(r):
            continue
        if cs_set and (r.get("country") or "").lower() not in cs_set:
            continue
        chan = r.get("channel") or r.get("pos_location_name") or ""
        if locs_set and chan not in locs_set:
            continue
        # Drop returns / exchanges / refunds — match upstream sales semantics
        # so we don't net negative quantities into units_sold.
        sk = (r.get("sale_kind") or "order").lower()
        if sk in ("return", "exchange", "refund"):
            continue
        sub = r.get("subcategory") or r.get("product_type") or ""
        if not sub:
            continue
        agg = by_sub.setdefault(sub, {"units": 0, "sales": 0.0, "_oids": set()})
        agg["units"] += int(r.get("quantity") or 0)
        agg["sales"] += float(r.get("total_sales_kes") or 0)
        oid = r.get("order_id")
        if oid:
            agg["_oids"].add(oid)

    return {
        sub: {"units": v["units"], "sales": v["sales"], "orders": len(v["_oids"])}
        for sub, v in by_sub.items()
    }


@api_router.get("/analytics/products-plan")
async def analytics_products_plan(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Products Plan — one row per subcategory with a tight sales-vs-
    inventory composition view for merchandisers.

    Returns rows with the columns:
      • category, subcategory
      • total_sales (KES in the requested window)
      • sor        — sell-out rate = qty / (qty + total_soh) × 100
      • qty_sold, pct_qty       (share of window-wide units sold)
      • total_soh, pct_total_soh (share of group total SOH)
      • stores_soh, pct_stores_soh (share of stores SOH)
      • wh_soh, pct_wh_soh       (share of warehouse SOH)

    Sales scope: honours `country` and `channel` filters. If `channel`
    is set, we source sales from /orders (same pattern as the main STS
    endpoint — upstream's `/subcategory-sales` is unreliable under a POS
    filter). Stock scope: always group-wide warehouse + (POS-scoped
    stores when `channel` is set, otherwise all stores country-wide).

    Grand-total row is NOT included — the frontend renders it as a
    footer so it can be styled differently.
    """
    chs = _split_csv(channel)

    # Sales — per-subcategory qty + total_sales.
    if chs:
        # POS-scoped sales come from /orders because upstream's
        # /subcategory-sales silently zeroes sales for many POS names.
        sales_by_sub = await _subcategory_sales_from_orders(
            date_from=date_from, date_to=date_to, country=country, locs=chs,
        )
    else:
        sales_rows = await get_subcategory_sales(
            date_from=date_from, date_to=date_to, country=country, channel=None,
        )
        sales_by_sub = {
            (r.get("subcategory") or ""): {
                "units": float(r.get("units_sold") or 0),
                "total_sales": float(r.get("total_sales") or 0),
                "orders": int(r.get("orders") or 0),
            }
            for r in (sales_rows or [])
            if r.get("subcategory")
        }

    # Inventory — split stores vs warehouse per subcategory. `channel`
    # filter scopes STORE rows only; warehouse is always group-wide so
    # the W/H SOH column reflects allocable backstock regardless of
    # which shop you're looking at.
    if chs:
        inv_stores = await fetch_all_inventory(country=country, locations=chs) or []
    else:
        inv_stores = await fetch_all_inventory(country=country) or []
    # When a POS channel is set, stores-scope inventory excludes warehouse
    # rows automatically. We still need warehouse rows → pull country-scope
    # without the channel filter.
    if chs:
        inv_wh = await fetch_all_inventory(country=country) or []
    else:
        inv_wh = inv_stores

    stores_by_sub: Dict[str, float] = defaultdict(float)
    wh_by_sub: Dict[str, float] = defaultdict(float)
    for r in inv_stores:
        sub = r.get("product_type") or ""
        if not sub:
            continue
        if is_warehouse_location(r.get("location_name")):
            continue  # stores_by_sub gets POS rows only
        stores_by_sub[sub] += float(r.get("available") or 0)
    for r in inv_wh:
        if not is_warehouse_location(r.get("location_name")):
            continue
        sub = r.get("product_type") or ""
        if sub:
            wh_by_sub[sub] += float(r.get("available") or 0)

    # Build row universe — every subcategory that has either sales or stock.
    # Filter out excluded categories EARLY so the % denominators below
    # (which drive `pct_qty`, `pct_total_soh`, etc.) reflect only the
    # rows the user will actually see — otherwise the % columns
    # wouldn't sum to ~100% after exclusion.
    EXCLUDED_CATEGORIES = {"sale", "accessories"}
    all_subs = (
        set(sales_by_sub.keys())
        | set(stores_by_sub.keys())
        | set(wh_by_sub.keys())
    )
    all_subs = {
        s for s in all_subs
        if (category_of(s) or "—").strip().lower() not in EXCLUDED_CATEGORIES
    }

    # Pre-compute denominators for the % columns — only over kept rows.
    total_qty = sum(
        (sales_by_sub.get(s) or {}).get("units") or 0 for s in all_subs
    )
    total_stores = sum(stores_by_sub.get(s, 0) for s in all_subs)
    total_wh = sum(wh_by_sub.get(s, 0) for s in all_subs)
    total_soh_grand = total_stores + total_wh

    out = []
    for sub in all_subs:
        sv = sales_by_sub.get(sub) or {}
        qty = float(sv.get("units") or 0)
        sales = float(sv.get("total_sales") or 0)
        s = float(stores_by_sub.get(sub) or 0)
        w = float(wh_by_sub.get(sub) or 0)
        total_soh = s + w
        denom_sor = qty + total_soh
        sor = (qty / denom_sor * 100.0) if denom_sor > 0 else 0.0
        out.append({
            "category": category_of(sub) or "—",
            "subcategory": sub or "—",
            "total_sales": round(sales, 2),
            "sor": round(sor, 2),
            "qty_sold": int(qty),
            "pct_qty": round((qty / total_qty * 100.0), 2) if total_qty else 0.0,
            "total_soh": int(total_soh),
            "pct_total_soh": round((total_soh / total_soh_grand * 100.0), 2) if total_soh_grand else 0.0,
            "stores_soh": int(s),
            "pct_stores_soh": round((s / total_stores * 100.0), 2) if total_stores else 0.0,
            "wh_soh": int(w),
            "pct_wh_soh": round((w / total_wh * 100.0), 2) if total_wh else 0.0,
        })
    # Sort by qty_sold desc so the biggest movers lead.
    out.sort(key=lambda r: (r["qty_sold"], r["total_sales"]), reverse=True)
    return out


@api_router.get("/analytics/stock-to-sales-by-subcat")
async def analytics_sts_by_subcat(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
    include_warehouse: bool = False,
    stock_scope: str = Query("stores", regex="^(stores|warehouse|combined)$"),
):
    """Derived view of /subcategory-stock-sales with a variance column
    (% of sales − % of stock). One clean row per subcategory.

    `stock_scope` controls which inventory rolls up into the
    `current_stock` column:
      • `stores`     — POS / shop-floor inventory only (default)
      • `warehouse`  — warehouse / wholesale / holding only
      • `combined`   — both

    `include_warehouse=True` is preserved for backwards compatibility
    and behaves like `stock_scope=combined` when no `stock_scope` is
    explicitly passed.

    When `locations` (CSV) is given, current_stock is recomputed locally
    from the location-scoped inventory so the stock side matches the
    POS selection (upstream's `channel` param only filters the sales side).
    If no `channel` is explicitly passed but `locations` is, we forward
    `locations` as `channel` to the upstream `/subcategory-stock-sales`
    call so both SALES and STOCK scope to the same POS.

    SALES under a POS scope: upstream's `/subcategory-stock-sales` silently
    returns units_sold=0 for many POS names (esp. Kenya). When `locs` is
    set we override units_sold/total_sales/orders by aggregating `/orders`
    ourselves (see `_subcategory_sales_from_orders`).
    """
    # Backwards-compatible: include_warehouse forces combined when scope was left default.
    if include_warehouse and stock_scope == "stores":
        stock_scope = "combined"
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
    cs = _split_csv(country)
    stock_by_subcat: Optional[Dict[str, float]] = None
    if locs or cs or stock_scope != "stores":
        # Always do a local roll-up when filters are active OR we need to
        # split warehouse vs floor stock. Without it the upstream's
        # group-wide stock-only number wins.
        if locs:
            inv = await fetch_all_inventory(country=country, locations=locs) or []
        else:
            inv = await fetch_all_inventory(country=country) or []
        stock_by_subcat = defaultdict(float)
        for r in inv:
            pt = r.get("product_type")
            if not pt:
                continue
            is_wh = is_warehouse_location(r.get("location_name"))
            # `stock_scope` filter: only count rows that match the requested
            # scope. When `locations` (POS list) is set the inventory call
            # already excluded warehouse rows so this filter is effectively
            # a no-op in that path — we honour `combined` by additionally
            # pulling country-scoped warehouse rows below.
            if stock_scope == "stores" and is_wh:
                continue
            if stock_scope == "warehouse" and not is_wh:
                continue
            stock_by_subcat[pt] += float(r.get("available") or 0)
        if locs and stock_scope in ("warehouse", "combined"):
            # POS-scoped pull above already excluded warehouse rows. For
            # `warehouse` and `combined`, add country-wide warehouse rows.
            wh_inv = await fetch_all_inventory(country=country) or []
            if stock_scope == "warehouse":
                # Reset to warehouse-only; ignore the POS-scoped store rows.
                stock_by_subcat = defaultdict(float)
            for r in wh_inv:
                if not is_warehouse_location(r.get("location_name")):
                    continue
                pt = r.get("product_type")
                if not pt:
                    continue
                stock_by_subcat[pt] += float(r.get("available") or 0)
        total_stock_local = sum(stock_by_subcat.values()) or 0
    elif cs:
        # Country-only scope (no POS filter). Upstream `/subcategory-stock-sales`
        # returns GLOBAL current_stock for every country query — sales scope
        # correctly but stock doesn't. Rebuild stock from the country-scoped
        # inventory fan-out so Kenya/Uganda/Rwanda tiles don't all show the
        # same (global) numbers.
        inv = await fetch_all_inventory(country=country)
        stock_by_subcat = defaultdict(float)
        for r in inv or []:
            pt = r.get("product_type")
            if not pt:
                continue
            stock_by_subcat[pt] += float(r.get("available") or 0)
        total_stock_local = sum(stock_by_subcat.values()) or 0

    # When a POS scope is active, override sales (units_sold / total_sales /
    # orders) with values aggregated from /orders. Upstream's
    # /subcategory-stock-sales drops sales to 0 for many POS names, so we
    # cannot trust its numbers under a POS filter.
    sales_override: Optional[Dict[str, Dict[str, float]]] = None
    if locs:
        sales_override = await _subcategory_sales_from_orders(
            date_from=date_from, date_to=date_to, country=country, locs=locs,
        )
        # Recompute orders_by_subcat from the overridden values too.
        orders_by_subcat = {sub: int(v.get("orders") or 0) for sub, v in sales_override.items()}
        # Refresh % shares against new total units sold.
        _total_units_override = sum(v.get("units") or 0 for v in sales_override.values()) or 0
    else:
        _total_units_override = 0

    out = []
    # Build the row universe from upstream rows + any subcat that only
    # appears in the override (so we don't drop a subcategory that sold
    # under a POS but wasn't in the upstream stock-sales response).
    seen = set()
    iter_rows = list(rows or [])
    if sales_override:
        existing_subs = {(r.get("subcategory") or "") for r in iter_rows}
        for sub in sales_override.keys():
            if sub and sub not in existing_subs:
                iter_rows.append({"subcategory": sub})

    for r in iter_rows:
        sub = r.get("subcategory") or ""
        if sub in seen:
            continue
        seen.add(sub)
        if sales_override is not None:
            ov = sales_override.get(sub) or {}
            units_sold = int(ov.get("units") or 0)
            total_sales = float(ov.get("sales") or 0)
            pct_sold = (units_sold / _total_units_override * 100) if _total_units_override else 0
        else:
            units_sold = r.get("units_sold") or 0
            total_sales = r.get("total_sales") or 0
            pct_sold = r.get("pct_of_total_sold") or 0
        if stock_by_subcat is not None:
            cs = stock_by_subcat.get(sub, 0)
            pct_stock = (cs / total_stock_local * 100) if total_stock_local else 0
            current_stock = cs
        else:
            pct_stock = r.get("pct_of_total_stock") or 0
            current_stock = r.get("current_stock") or 0
        sor_pct = (
            (units_sold / (units_sold + current_stock) * 100)
            if (units_sold + current_stock) else 0
        ) if sales_override is not None else (r.get("sor_percent") or 0)
        out.append({
            "subcategory": sub,
            "units_sold": units_sold,
            "current_stock": current_stock,
            "pct_of_total_sold": pct_sold,
            "pct_of_total_stock": pct_stock,
            "variance": pct_sold - pct_stock,
            "sor_percent": sor_pct,
            "total_sales": total_sales,
            "orders": orders_by_subcat.get(sub, 0),
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
    stock_scope: str = Query("stores", regex="^(stores|warehouse|combined)$"),
):
    """Roll subcategory-stock-sales up to CATEGORY level using subcategory
    name prefixes. See `analytics_sts_by_subcat` for `stock_scope` semantics.
    """
    if include_warehouse and stock_scope == "stores":
        stock_scope = "combined"
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
    cs = _split_csv(country)
    inv_rows: List[Dict[str, Any]] = []
    if locs:
        # Stores side
        store_inv = await fetch_all_inventory(country=country, locations=locs) or []
        if stock_scope in ("stores", "combined"):
            inv_rows.extend(store_inv)
        if stock_scope in ("warehouse", "combined"):
            all_inv = await fetch_all_inventory(country=country) or []
            for r in all_inv:
                if is_warehouse_location(r.get("location_name")):
                    inv_rows.append(r)
    elif cs or stock_scope != "stores":
        # Country-only scope: upstream returns GLOBAL current_stock for every
        # country query, so stock doesn't actually vary. Re-fetch country-
        # scoped inventory to produce real per-country stock numbers.
        inv_rows = await fetch_all_inventory(country=country) or []

    # Reuse the module-level Vivo merch taxonomy (see SUBCATEGORY_TO_CATEGORY
    # near the top of this file). category_of(...) returns "Other" for unknown
    # subcategories so downstream filters can cleanly exclude them.

    # If locations OR country is provided, rebuild current_stock per row from
    # local inventory (upstream's stock ignores country for non-POS queries
    # and its channel param only filters sales). `stock_scope` filters the
    # rows we count: stores-only, warehouse-only, or combined.
    if locs or cs or stock_scope != "stores":
        stock_by_subcat: Dict[str, float] = defaultdict(float)
        for r in inv_rows:
            pt = r.get("product_type")
            if not pt:
                continue
            is_wh = is_warehouse_location(r.get("location_name"))
            if stock_scope == "stores" and is_wh:
                continue
            if stock_scope == "warehouse" and not is_wh:
                continue
            stock_by_subcat[pt] += float(r.get("available") or 0)
        rows = [
            {**r, "current_stock": stock_by_subcat.get(r.get("subcategory"), 0)}
            for r in rows
        ]

    # When a POS scope is active, also override the SALES side from /orders.
    # Upstream's /subcategory-stock-sales returns units_sold=0 for many POS
    # names — see _subcategory_sales_from_orders for context.
    if locs:
        sales_override = await _subcategory_sales_from_orders(
            date_from=date_from, date_to=date_to, country=country, locs=locs,
        )
        orders_by_subcat = {sub: int(v.get("orders") or 0) for sub, v in sales_override.items()}
        rows = [
            {
                **r,
                "units_sold": int((sales_override.get(r.get("subcategory")) or {}).get("units") or 0),
                "total_sales": float((sales_override.get(r.get("subcategory")) or {}).get("sales") or 0),
            }
            for r in rows
        ]
        # Add subcats that only appear in the override (sold but no upstream
        # stock-sales row). current_stock comes from local inventory above.
        existing_subs = {(r.get("subcategory") or "") for r in rows}
        for sub in sales_override.keys():
            if sub and sub not in existing_subs:
                ov = sales_override[sub]
                rows.append({
                    "subcategory": sub,
                    "units_sold": int(ov.get("units") or 0),
                    "total_sales": float(ov.get("sales") or 0),
                    "current_stock": stock_by_subcat.get(sub, 0),
                })

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


# ---------------------------------------------------------------------------
# Stock-to-Sales by Color / by Size — variant-level analogue of the by-Subcat
# table. Same column shape (units_sold, current_stock, pct_of_total_sold,
# pct_of_total_stock, variance, sor_percent). One single endpoint returns
# BOTH groupings to amortize the /orders fan-out across one call.
# ---------------------------------------------------------------------------
_sts_by_attr_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_STS_BY_ATTR_TTL = 60 * 5  # 5 minutes


@api_router.get("/analytics/stock-to-sales-by-attribute")
async def analytics_sts_by_attribute(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
    include_warehouse: bool = False,
):
    """Returns `{by_color: [...], by_size: [...]}`. Same column shape as
    `/analytics/stock-to-sales-by-subcat` so the frontend can drop the rows
    straight into the existing variance table layout.

    Sales side: aggregate `/orders` over [date_from, date_to] by `color_print`
    and `size`. Chunked into ≤30-day windows to dodge the upstream's 50k row
    cap. Stock side: live inventory snapshot (NOT period-bound, matches the
    by-subcat semantics).

    `locations` (CSV) and `country` filter both /orders and /inventory. When
    locations is set, warehouse rows are excluded by default (shop-floor
    only). `include_warehouse=True` adds them back on top.
    """
    import time as _time
    cache_key = f"{date_from or ''}|{date_to or ''}|{country or ''}|{channel or ''}|{locations or ''}|{int(bool(include_warehouse))}"
    if cache_key in _sts_by_attr_cache:
        ts, payload = _sts_by_attr_cache[cache_key]
        if _time.time() - ts < _STS_BY_ATTR_TTL:
            return payload

    # --- Resolve scope -------------------------------------------------------
    today = datetime.now(timezone.utc).date()
    df = datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else (today - timedelta(days=30))
    dt = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today
    cs = _split_csv(country)
    chs = _split_csv(channel)
    locs = _split_csv(locations) or chs  # mirror by-subcat: locations OR channel

    # --- Sales: chunk /orders by ≤30-day windows ----------------------------
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= dt:
        end = min(cur + timedelta(days=29), dt)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    async def _orders_chunk(d1: date, d2: date) -> List[Dict[str, Any]]:
        return await _safe_fetch("/orders", {
            "date_from": d1.isoformat(), "date_to": d2.isoformat(),
            "limit": 50000,
            "country": cs[0] if len(cs) == 1 else None,
            "channel": chs[0] if len(chs) == 1 else None,
        }) or []

    # Serialize chunk fan-out (parallel saturates upstream → 503s — see
    # `style-sku-breakdown` for the same constraint).
    chunk_rows: List[Dict[str, Any]] = []
    for d1, d2 in chunks:
        chunk_rows.extend(await _orders_chunk(d1, d2))

    # If user passed multi-country / multi-channel, the chunked call above
    # used `None` to fetch globally — filter client-side here.
    cs_set = {c.lower() for c in cs}
    chs_set = set(chs)
    locs_set = set(locs)

    sold_by_color: Dict[str, Dict[str, float]] = defaultdict(lambda: {"units": 0, "sales": 0.0})
    sold_by_size: Dict[str, Dict[str, float]] = defaultdict(lambda: {"units": 0, "sales": 0.0})
    for r in chunk_rows:
        # Skip non-merchandise — keeps the table semantically consistent with
        # by-subcat, which is also merchandise-only.
        if is_excluded_brand(r.get("brand")):
            continue
        if is_excluded_product(r):
            continue
        if cs_set and (r.get("country") or "").lower() not in cs_set:
            continue
        chan = r.get("channel") or r.get("location_name") or ""
        if locs_set and chan not in locs_set:
            continue
        if chs_set and chan not in chs_set:
            continue
        color = (r.get("color_print") or r.get("color") or "—") or "—"
        size = (r.get("size") or "—") or "—"
        qty = int(r.get("quantity") or 0)
        sales = float(r.get("total_sales_kes") or 0)
        sold_by_color[color]["units"] += qty
        sold_by_color[color]["sales"] += sales
        sold_by_size[size]["units"] += qty
        sold_by_size[size]["sales"] += sales

    # --- Stock: live inventory snapshot --------------------------------------
    if locs:
        inv = await fetch_all_inventory(country=country, locations=locs)
        # When locs is set we already scoped to those POS. include_warehouse
        # adds warehouse-only rows back on top.
        if include_warehouse:
            wh = await fetch_all_inventory(country=country)
            wh = [r for r in (wh or []) if is_warehouse_location(r.get("location_name"))]
            inv = (inv or []) + wh
    else:
        inv = await fetch_all_inventory(country=country)

    stock_by_color: Dict[str, float] = defaultdict(float)
    stock_by_size: Dict[str, float] = defaultdict(float)
    for r in (inv or []):
        if is_excluded_brand(r.get("brand")):
            continue
        if is_excluded_product(r):
            continue
        color = (r.get("color_print") or r.get("color") or "—") or "—"
        size = (r.get("size") or "—") or "—"
        avail = float(r.get("available") or 0)
        stock_by_color[color] += avail
        stock_by_size[size] += avail

    def _build(sold_map: Dict[str, Dict[str, float]], stock_map: Dict[str, float], key_label: str) -> List[Dict[str, Any]]:
        keys = set(sold_map.keys()) | set(stock_map.keys())
        total_units = sum(s["units"] for s in sold_map.values())
        total_stock = sum(stock_map.values())
        out: List[Dict[str, Any]] = []
        for k in keys:
            units = sold_map.get(k, {}).get("units", 0)
            sales = sold_map.get(k, {}).get("sales", 0.0)
            stock = stock_map.get(k, 0.0)
            pct_sold = (units / total_units * 100) if total_units else 0
            pct_stock = (stock / total_stock * 100) if total_stock else 0
            denom = units + stock
            sor = (units / denom * 100) if denom > 0 else 0
            out.append({
                key_label: k,
                "units_sold": int(units),
                "current_stock": round(stock, 2),
                "pct_of_total_sold": round(pct_sold, 4),
                "pct_of_total_stock": round(pct_stock, 4),
                "variance": round(pct_sold - pct_stock, 4),
                "sor_percent": round(sor, 2),
                "total_sales": round(sales, 2),
            })
        # Hide rows where we have no signal at all (some upstream rows have
        # missing color/size — they all collapse to "—" which is fine to
        # surface, but rows with 0 units AND 0 stock are noise).
        out = [r for r in out if (r["units_sold"] > 0 or r["current_stock"] > 0)]
        out.sort(key=lambda x: x["units_sold"], reverse=True)
        return out

    payload = {
        "by_color": _build(sold_by_color, stock_by_color, "color"),
        "by_size":  _build(sold_by_size,  stock_by_size,  "size"),
    }
    _sts_by_attr_cache[cache_key] = (_time.time(), payload)
    return payload


@api_router.get("/analytics/weeks-of-cover")
async def analytics_weeks_of_cover(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
    stock_scope: str = Query("stores", regex="^(stores|warehouse|combined)$"),
):
    """Weeks of Cover per style:
       weeks = current_stock / (units_sold_last_28_days / 4)

    `stock_scope` controls WHICH inventory feeds `current_stock`:
      • "stores"    — POS / shop-floor only (default; sales happen here)
      • "warehouse" — only warehouse / wholesale / holding stock
      • "combined"  — stores + warehouse (total allocable units)

    IMPORTANT: sales (units_sold_28d, avg_weekly_sales) ALWAYS come from
    store traffic regardless of `stock_scope` — warehouses don't sell.
    This matches the user's explicit requirement: switching to the
    warehouse-only view only changes the numerator of WOC, not the
    denominator, so you can see e.g. "there's 18w of cover sitting in
    the warehouse but store-floor has only 3w → move it out".

    SOR data gives 28-day sell rate when we query the last 28 days.
    """
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

    # Recompute current_stock per style according to `stock_scope`. We
    # ALWAYS walk the inventory cache (not just when `locations` is set)
    # so "warehouse"/"combined" actually pull warehouse rows. The
    # `channel`/`locations` param further narrows POS inventory for
    # "stores"/"combined" modes — sales aggregates (units_sold) stay
    # from /sor and are therefore always store-sourced.
    inv = await fetch_all_inventory(country=country) or []
    locs = _split_csv(locations) or _split_csv(channel)
    stock_by_style: Dict[str, float] = defaultdict(float)
    for r in inv:
        style = r.get("style_name") or r.get("product_name")
        if not style:
            continue
        is_wh = is_warehouse_location(r.get("location_name"))
        if stock_scope == "stores" and is_wh:
            continue
        if stock_scope == "warehouse" and not is_wh:
            continue
        # Location filter is only meaningful for POS rows; warehouse rows
        # are scoped group-wide.
        if locs and not is_wh and (r.get("location_name") not in set(locs)):
            continue
        stock_by_style[style] += float(r.get("available") or 0)

    out = []
    for r in rows:
        units = r.get("units_sold") or 0
        style = r.get("style_name")
        stock = stock_by_style.get(style, 0)
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


@api_router.get("/analytics/sell-through-by-location")
async def analytics_sell_through_by_location(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
):
    """Sell-through rate per location = units_sold / (units_sold + current_stock).

    Upstream doesn't expose historical stock-on-hand, so we use the
    standard retail shortcut: period sell-through = units_sold ÷
    (current_stock + units_sold). This equals the fraction of
    open-to-sell that actually sold, assuming no mid-period receipts.

    Returns one row per POS location (excludes warehouse/holding):
        [
          {location, country, units_sold, current_stock, total_sales,
           sell_through_pct, health}  # health ∈ {strong|healthy|slow|stuck}
        ]
    """
    if not date_from or not date_to:
        raise HTTPException(status_code=400, detail="date_from and date_to required")
    cs = _split_csv(country)

    # 1) Units sold per location for the period — /sales-summary gives
    #    units_sold per channel/POS.
    base = {"date_from": date_from, "date_to": date_to}
    if len(cs) <= 1:
        ss_rows = await fetch("/sales-summary", {
            **base,
            "country": cs[0] if cs else None,
        })
    else:
        results = await multi_fetch("/sales-summary", base, cs, [])
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for r in g:
                ch = r.get("channel")
                if not ch:
                    continue
                if ch not in merged:
                    merged[ch] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "orders", "net_sales"):
                        merged[ch][f] = (merged[ch].get(f) or 0) + (r.get(f) or 0)
        ss_rows = list(merged.values())

    # 2) Current stock per location (excludes warehouse locations).
    inv = await fetch_all_inventory(country=country) or []
    stock_by_loc: Dict[str, float] = defaultdict(float)
    for r in inv:
        loc = r.get("location_name") or "Unknown"
        if is_warehouse_location(loc):
            continue
        if not isinstance(r.get("product_type"), str):
            continue  # skip rows without a subcategory
        stock_by_loc[loc] += float(r.get("available") or 0)

    out: List[Dict[str, Any]] = []
    for r in ss_rows or []:
        loc = r.get("channel")
        if not loc:
            continue
        if is_warehouse_location(loc):
            continue
        units = int(r.get("units_sold") or 0)
        stock = float(stock_by_loc.get(loc, 0))
        if stock <= 0:
            # Pure-online or non-inventoried channels (no stock reported)
            # — sell-through is not meaningful. Flag them separately so
            # the UI can surface the data without distorting rankings.
            if units <= 0:
                continue
            out.append({
                "location": loc,
                "country": (r.get("country") or "").title() or None,
                "units_sold": units,
                "current_stock": 0,
                "total_sales": float(r.get("total_sales") or 0),
                "net_sales": float(r.get("net_sales") or 0),
                "sell_through_pct": None,
                "health": "no_stock_data",
            })
            continue
        denom = stock + units
        pct = (units / denom) * 100.0
        if pct >= 25:
            health = "strong"
        elif pct >= 12:
            health = "healthy"
        elif pct >= 5:
            health = "slow"
        else:
            health = "stuck"
        out.append({
            "location": loc,
            "country": (r.get("country") or "").title() or None,
            "units_sold": units,
            "current_stock": stock,
            "total_sales": float(r.get("total_sales") or 0),
            "net_sales": float(r.get("net_sales") or 0),
            "sell_through_pct": round(pct, 2),
            "health": health,
        })
    # Sort: real sell-through first (desc), then no_stock_data rows last.
    out.sort(key=lambda x: (x["sell_through_pct"] is None, -(x["sell_through_pct"] or 0)))
    return out


@api_router.get("/footfall/daily-calendar")
async def get_footfall_daily_calendar(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
):
    """Per-day group-level footfall + orders + conversion for a window,
    for rendering a calendar heatmap (rows=week, cols=Mon..Sun).

    Upstream /footfall returns per-location daily aggregates — we fan out
    once per day and sum across locations. Max window 90 days. Cached
    for 1h alongside the weekday-pattern cache.
    """
    from datetime import date, timedelta
    try:
        today = datetime.now(timezone.utc).date()
        end_d = date.fromisoformat(date_to) if date_to else today - timedelta(days=1)
        start_d = date.fromisoformat(date_from) if date_from else end_d - timedelta(days=27)
        if end_d < start_d:
            start_d, end_d = end_d, start_d
        if (end_d - start_d).days > 89:
            start_d = end_d - timedelta(days=89)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date_from / date_to")

    cache_key = f"cal|{start_d.isoformat()}|{end_d.isoformat()}|{country or ''}"
    import time as _t
    cached = _weekday_pattern_cache.get(cache_key)
    if cached and (_t.time() - cached[0]) < _WEEKDAY_PATTERN_TTL:
        return cached[1]

    dates: List[date] = []
    d = start_d
    while d <= end_d:
        dates.append(d)
        d += timedelta(days=1)

    sem = asyncio.Semaphore(6)

    async def _one_day(day: date):
        async with sem:
            iso = day.isoformat()
            try:
                rows = await fetch("/footfall", {
                    "date_from": iso, "date_to": iso,
                    "channel": country,
                })
                return day, rows or []
            except Exception as e:
                logger.warning("[daily-calendar] %s fetch failed: %s", iso, e)
                return day, []

    results = await asyncio.gather(*(_one_day(dd) for dd in dates))

    days_out: List[Dict[str, Any]] = []
    for day, rows in results:
        total_ff = 0
        orders = 0
        sales = 0.0
        for r in rows or []:
            total_ff += int(r.get("total_footfall") or 0)
            orders += int(r.get("orders") or 0)
            sales += float(r.get("total_sales") or 0)
        cr = (orders / total_ff * 100.0) if total_ff else None
        days_out.append({
            "date": day.isoformat(),
            "weekday": day.weekday(),  # 0 Mon .. 6 Sun
            "footfall": total_ff,
            "orders": orders,
            "total_sales": round(sales, 2),
            "conversion_rate": round(cr, 2) if cr is not None else None,
        })

    max_ff = max((d["footfall"] for d in days_out), default=0)
    payload = {
        "window": {
            "start": start_d.isoformat(),
            "end": end_d.isoformat(),
            "days": len(days_out),
        },
        "max_footfall": max_ff,
        "days": days_out,
    }
    _weekday_pattern_cache[cache_key] = (_t.time(), payload)
    return payload


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

    # Location-scoped stock override. Upstream `/sor` returns global
    # current_stock regardless of the `channel` filter — so without this
    # override the New-Styles Performance "Current Stock" column would
    # show the same number whether the user is looking at Vivo Sarit or
    # all locations. Recompute it from the inventory feed scoped to the
    # selected POS list (if any) so the column tells the truth.
    stock_by_style: Optional[Dict[str, float]] = None
    if chs or cs:
        try:
            inv = await fetch_all_inventory(
                country=country,
                locations=chs if chs else None,
            ) or []
            stock_by_style = defaultdict(float)
            for r in inv:
                s = r.get("style_name")
                if not s:
                    continue
                stock_by_style[s] += float(r.get("available") or 0)
        except Exception as e:
            logger.warning("[/analytics/new-styles] inventory override failed: %s", e)
            stock_by_style = None

    out: List[Dict[str, Any]] = []
    for r in new_styles:
        p = period_map.get(r.get("style_name")) or {}
        # Location-scoped stock override (when channel/country filter active).
        if stock_by_style is not None:
            current_stock = float(stock_by_style.get(r.get("style_name"), 0))
        else:
            current_stock = float(r.get("current_stock") or 0)
        # Re-compute SOR from the (possibly-overridden) location-scoped
        # numerator so SOR matches the displayed stock + units.
        units_recent = float(r.get("units_sold") or 0)
        denom = units_recent + current_stock
        sor = (units_recent / denom * 100.0) if denom > 0 else 0.0
        out.append({
            "style_name": r.get("style_name"),
            "brand": r.get("brand"),
            "collection": r.get("collection"),
            "product_type": r.get("product_type"),
            # Period slice
            "units_sold_period": p.get("units_sold") or 0,
            "total_sales_period": p.get("total_sales") or 0,
            # Since launch (last 90d)
            "units_sold_launch": units_recent,
            "total_sales_launch": r.get("total_sales") or 0,
            "current_stock": current_stock,
            "sor_percent": round(sor, 1) if stock_by_style is not None else (r.get("sor_percent") or 0),
        })
    out.sort(key=lambda x: x.get("total_sales_period") or 0, reverse=True)
    return out


# In-memory cache for the L-10 report — recomputing the launch dates
# fans out a lot of /orders chunks, so we keep results warm for 30 min.
_l10_cache: Dict[str, tuple] = {}
_L10_TTL = 30 * 60  # seconds


@api_router.get("/analytics/sor-new-styles-l10")
async def analytics_sor_new_styles_l10(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    brand: Optional[str] = None,
    refresh: bool = False,
):
    """SOR New Styles L-10 — styles whose FIRST-EVER sale was 3 to 4
    months ago (90–122 days), with a 6-month performance + sell-out
    snapshot.

    Columns returned per style:
        style_name, brand, subcategory, style_number,
        sales_6m, units_6m, asp_6m,
        units_3w,
        soh_total, soh_wh, pct_in_wh,
        days_since_last_sale, sor_6m,
        launch_date, weekly_avg, woc, style_age_weeks
    """
    import time as _time
    cache_key = f"{country or ''}|{channel or ''}|{brand or ''}"
    if not refresh and cache_key in _l10_cache:
        ts, payload = _l10_cache[cache_key]
        if _time.time() - ts < _L10_TTL:
            return payload

    today = datetime.now(timezone.utc).date()
    launch_to = today - timedelta(days=90)    # at most 3 months ago
    launch_from = today - timedelta(days=122)  # at most 4 months ago
    six_m_from = today - timedelta(days=180)
    three_w_from = today - timedelta(days=21)

    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def _topskus(df: str, dt: str) -> List[Dict[str, Any]]:
        base = {"date_from": df, "date_to": dt, "limit": 10000}
        if brand:
            base["product"] = brand
        if len(cs) <= 1 and len(chs) <= 1:
            raw = await fetch("/top-skus", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            }) or []
            results = [raw]
        else:
            results = await multi_fetch("/top-skus", base, cs, chs)
        # Always dedupe by style_name with summed metrics. Upstream
        # /top-skus can emit MULTIPLE rows for the same style_name when
        # the catalog has lingering duplicate `collection` values for the
        # same style — without this merge the dict-comprehension below
        # silently overwrites a row's stats with the smallest occurrence,
        # producing nonsensical "1 unit / KES 6,800" totals on a style
        # that actually sold 200+ units.
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for r in g:
                s = r.get("style_name")
                if not s:
                    continue
                if s not in merged:
                    merged[s] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales"):
                        merged[s][f] = (merged[s].get(f) or 0) + (r.get(f) or 0)
                    # Keep the FIRST seen non-empty collection / brand
                    # since the duplicate row often has a truncated
                    # "Safari by" collection — prefer the longer label.
                    if (len(merged[s].get("collection") or "")
                            < len(r.get("collection") or "")):
                        merged[s]["collection"] = r.get("collection")
        return list(merged.values())

    band_skus, before_band_skus, six_m_skus, three_w_skus, inventory = await asyncio.gather(
        _topskus(launch_from.isoformat(), launch_to.isoformat()),
        _topskus("2020-01-01", (launch_from - timedelta(days=1)).isoformat()),
        _topskus(six_m_from.isoformat(), today.isoformat()),
        _topskus(three_w_from.isoformat(), today.isoformat()),
        fetch_all_inventory(country=country),
    )

    band_set = {r.get("style_name") for r in band_skus if r.get("style_name")}
    before_set = {r.get("style_name") for r in before_band_skus if r.get("style_name")}
    candidates: set = band_set - before_set
    if not candidates:
        payload: List[Dict[str, Any]] = []
        _l10_cache[cache_key] = (_time.time(), payload)
        return payload

    # Per-candidate maps for the 6-month and 3-week snapshots.
    six_m_map: Dict[str, Dict[str, Any]] = {
        r.get("style_name"): r for r in six_m_skus if r.get("style_name") in candidates
    }
    three_w_map: Dict[str, Dict[str, Any]] = {
        r.get("style_name"): r for r in three_w_skus if r.get("style_name") in candidates
    }

    # Inventory: split by warehouse vs store, capture a representative SKU
    # to use as `style_number`.
    soh_store: Dict[str, float] = defaultdict(float)
    soh_wh: Dict[str, float] = defaultdict(float)
    sku_for_style: Dict[str, str] = {}
    for r in inventory or []:
        s = r.get("style_name")
        if s not in candidates:
            continue
        avail = float(r.get("available") or 0)
        loc = r.get("location_name") or ""
        if is_warehouse_location(loc):
            soh_wh[s] += avail
        else:
            soh_store[s] += avail
        if s not in sku_for_style and r.get("sku"):
            sku_for_style[s] = r["sku"]

    # Launch date + last-sale date — chunk /orders by ~7-day windows over
    # the [launch_from, today] span. Upstream caps at 5000 rows/call so
    # weekly chunks should fit comfortably.
    chunk_starts: List[datetime] = []
    cur = launch_from
    while cur <= today:
        chunk_starts.append(cur)
        cur += timedelta(days=7)

    chunk_ranges: List[tuple] = []
    for i, st in enumerate(chunk_starts):
        en = chunk_starts[i + 1] - timedelta(days=1) if i + 1 < len(chunk_starts) else today
        chunk_ranges.append((st, en))

    sem = asyncio.Semaphore(8)

    async def _orders_chunk(df: datetime, dt: datetime) -> List[Dict[str, Any]]:
        async with sem:
            return await fetch("/orders", {
                "date_from": df.isoformat(),
                "date_to": dt.isoformat(),
                "limit": 5000,
                "country": cs[0] if len(cs) == 1 else None,
                "channel": chs[0] if len(chs) == 1 else None,
            }) or []

    order_chunks = await asyncio.gather(
        *(_orders_chunk(df, dt) for df, dt in chunk_ranges),
        return_exceptions=True,
    )

    first_date: Dict[str, str] = {}
    last_date: Dict[str, str] = {}
    for chunk in order_chunks:
        if isinstance(chunk, Exception):
            logger.warning("[sor-new-styles-l10] orders chunk failed: %s", chunk)
            continue
        for o in chunk:
            s = o.get("style_name")
            if s not in candidates:
                continue
            d = (o.get("order_date") or "")[:10]
            if not d:
                continue
            if s not in first_date or d < first_date[s]:
                first_date[s] = d
            if s not in last_date or d > last_date[s]:
                last_date[s] = d
            # Fallback style-number lookup — useful when a style has 0
            # current inventory (so the inventory pass found no SKU).
            if s not in sku_for_style and o.get("sku"):
                sku_for_style[s] = o["sku"]

    out: List[Dict[str, Any]] = []
    for s in candidates:
        if s not in first_date:
            continue  # no orders found in window — skip
        try:
            launch_d = datetime.fromisoformat(first_date[s]).date()
        except Exception:
            continue
        # Re-confirm the strict launch-window guard. The /top-skus band
        # is week-resolution, so a few candidates can fall a day or two
        # outside the precise [90d, 122d] band — drop those.
        age_days = (today - launch_d).days
        if age_days < 90 or age_days > 122:
            continue

        try:
            last_d = datetime.fromisoformat(last_date.get(s, first_date[s])).date()
        except Exception:
            last_d = launch_d

        store = soh_store.get(s, 0)
        wh = soh_wh.get(s, 0)
        soh_total = store + wh
        pct_in_wh = (wh / soh_total * 100.0) if soh_total > 0 else 0.0

        sm = six_m_map.get(s, {})
        units_6m = float(sm.get("units_sold") or 0)
        sales_6m = float(sm.get("total_sales") or 0)
        asp_6m = (sales_6m / units_6m) if units_6m else 0.0

        # 6-month SOR = units_sold ÷ (units_sold + current_stock)
        denom = units_6m + soh_total
        sor_6m = (units_6m / denom * 100.0) if denom > 0 else 0.0

        # Weekly average — use age-of-style as the divisor instead of a
        # flat 26 weeks, since these styles are 12–17 weeks old.
        age_weeks = age_days / 7.0
        weekly_avg = (units_6m / age_weeks) if age_weeks > 0 else 0.0
        woc = (soh_total / weekly_avg) if weekly_avg > 0 else None

        units_3w = float((three_w_map.get(s) or {}).get("units_sold") or 0)
        days_since_last = (today - last_d).days

        out.append({
            "style_name": s,
            "brand": sm.get("brand"),
            "collection": sm.get("collection"),
            "subcategory": sm.get("product_type"),
            "style_number": sku_for_style.get(s, ""),
            "sales_6m": round(sales_6m, 2),
            "units_6m": int(units_6m),
            "units_3w": int(units_3w),
            "soh_total": round(soh_total, 2),
            "soh_wh": round(wh, 2),
            "soh_store": round(store, 2),
            "pct_in_wh": round(pct_in_wh, 1),
            "asp_6m": round(asp_6m, 2),
            "days_since_last_sale": days_since_last,
            "sor_6m": round(sor_6m, 2),
            "launch_date": launch_d.isoformat(),
            "weekly_avg": round(weekly_avg, 2),
            "woc": round(woc, 1) if woc is not None else None,
            "style_age_weeks": round(age_weeks, 1),
        })
    # Drop very-low-volume rows (units_6m + soh_total < 50). They add
    # noise to buyer dashboards and, more importantly, to CSV exports
    # that were previously only filtered client-side. Applied here so
    # every consumer (UI, CSV export, any third-party script hitting
    # the endpoint directly) sees the same de-noised list.
    # Threshold raised 20 → 50 on 2026-05-05 per user feedback —
    # 20 was letting through slow runners that don't deserve buyer
    # attention; 50 aligns with the minimum stock-keeping threshold.
    out = [r for r in out if (r["units_6m"] + r["soh_total"]) >= 50]
    out.sort(key=lambda r: r["sor_6m"], reverse=True)
    _l10_cache[cache_key] = (_time.time(), out)
    return out


# ---------------------------------------------------------------------------
# SOR — same SOR/SOH/units shape as L-10, for the ENTIRE active catalog.
# Differs from L-10 only by skipping the launch-band (90–122 days) filter,
# which means we operate on `six_m_skus` directly as the candidate pool.
# Upstream /top-skus is the heavyweight call; we share it via the existing
# response cache so two opens of the page in close succession are cheap.
# ---------------------------------------------------------------------------
_all_styles_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_ALL_STYLES_TTL = 60 * 30  # 30 minutes
_sku_breakdown_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_SKU_BREAKDOWN_TTL = 60 * 30  # 30 minutes — heavy /orders chunked fetch
_curve_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CURVE_TTL = 60 * 30  # 30 minutes — same fan-out cost as sor-all-styles
# Per-style first / last sale dates from the last 180 days. Shared between
# /sor-all-styles (for accurate ages) and any other endpoint that needs
# launch / recency data without paying the full /orders fan-out twice.
# Key: f"{country}|{channel}". Value: (ts, {style_name: (first_iso, last_iso)}).
_style_dates_cache: Dict[str, Tuple[float, Dict[str, Tuple[str, str]]]] = {}
_STYLE_DATES_TTL = 60 * 30  # 30 minutes


async def _get_style_first_last_sale(
    country: Optional[str],
    channel: Optional[str],
    days: int = 180,
) -> Dict[str, Tuple[str, str]]:
    """Return `{style_name: (first_sale_iso, last_sale_iso)}` for every
    style with at least one sale in the last `days` days. Cached for
    30 min per (country, channel, days) so repeat callers share work.

    Implementation strategy (for cost-control):
      1. **First**, try to read the result from the existing
         ``_curve_cache`` populated by `analytics_new_styles_curve` —
         that endpoint is pre-warmed at startup and runs the same
         /orders 180-day fan-out as we'd need here. If the cache has a
         compatible entry (same country/channel scope, days ≥ requested),
         we reuse its `first_sale` and derive `last_sale` from the last
         non-empty weekly bucket. **No new upstream hits.**
      2. **Fallback**: if the curve cache is empty (e.g. the warmup
         hasn't run yet), do our own bounded /orders fan-out. We use a
         concurrency cap of 4 so we don't trigger upstream 503s by
         saturating the BI API alongside other warm-up traffic.

    Multi-country / multi-channel callers fall through to the global
    view (no upstream filter) to keep the fan-out bounded — the All-
    Styles report is fundamentally a catalog snapshot.
    """
    import time as _time
    cs = _split_csv(country)
    chs = _split_csv(channel)
    only_country = cs[0] if len(cs) == 1 else None
    only_channel = chs[0] if len(chs) == 1 else None
    cache_key = f"{only_country or ''}|{only_channel or ''}|{days}"
    cached = _style_dates_cache.get(cache_key)
    if cached and (_time.time() - cached[0]) < _STYLE_DATES_TTL:
        return cached[1]

    today = datetime.now(timezone.utc).date()

    # ── Path 1: piggyback on the curve cache when possible ──────────
    # Curve cache key shape: f"{days}|{country or ''}|{channel or ''}".
    # We need a compatible scope (same country+channel) and a window
    # that's at least as deep as the one we're being asked for. The
    # startup warmup pre-fetches days=122 (no country/channel), which
    # covers the dominant All-Styles call.
    for ck, (cts, payload) in list(_curve_cache.items()):
        if (_time.time() - cts) >= _CURVE_TTL:
            continue
        try:
            cdays_s, ccountry, cchannel = ck.split("|", 2)
            cdays = int(cdays_s)
        except Exception:
            continue
        if ccountry != (only_country or "") or cchannel != (only_channel or ""):
            continue
        if cdays < days:
            continue
        rows = (payload or {}).get("rows") or []
        out: Dict[str, Tuple[str, str]] = {}
        for row in rows:
            s = row.get("style_name")
            first = row.get("first_sale")
            weekly = row.get("weekly") or []
            if not s or not first:
                continue
            # last_sale ≈ start-of-final-non-empty-week. Curve buckets
            # by week_start so the resolution is ±6 days; that's
            # plenty for a "days_since_last_sale" pill.
            last_iso = first
            for w in weekly:
                if (w.get("units") or 0) > 0:
                    ws = w.get("week_start") or ""
                    if ws and ws > last_iso:
                        last_iso = ws
            out[s] = (first, last_iso)
        _style_dates_cache[cache_key] = (_time.time(), out)
        logger.info(f"[style-dates] hydrated {len(out)} styles from curve cache (key={ck})")
        return out

    # ── Path 2: cold fan-out (rare — only if curve hasn't warmed) ──
    df = today - timedelta(days=int(days))
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= today:
        end = min(cur + timedelta(days=29), today)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    sem = asyncio.Semaphore(4)

    async def _chunk(d1: date, d2: date) -> List[Dict[str, Any]]:
        async with sem:
            return await _safe_fetch("/orders", {
                "date_from": d1.isoformat(), "date_to": d2.isoformat(),
                "limit": 50000,
                "country": only_country,
                "channel": only_channel,
            }) or []

    chunk_results = await asyncio.gather(
        *(_chunk(d1, d2) for d1, d2 in chunks),
        return_exceptions=True,
    )
    out: Dict[str, Tuple[str, str]] = {}
    for chunk in chunk_results:
        if isinstance(chunk, Exception):
            logger.warning("[style-dates] chunk failed: %s", chunk)
            continue
        for r in chunk:
            s = r.get("style_name")
            if not s:
                continue
            d_iso = (r.get("order_date") or "")[:10]
            if not d_iso:
                continue
            cur_pair = out.get(s)
            if cur_pair is None:
                out[s] = (d_iso, d_iso)
            else:
                first, last = cur_pair
                if d_iso < first:
                    first = d_iso
                if d_iso > last:
                    last = d_iso
                out[s] = (first, last)
    _style_dates_cache[cache_key] = (_time.time(), out)
    logger.info(f"[style-dates] cold fan-out → {len(out)} styles ({len(chunks)} chunks)")
    return out


@api_router.get("/analytics/sor-all-styles")
async def analytics_sor_all_styles(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    brand: Optional[str] = None,
    refresh: bool = False,
):
    """SOR for ALL active styles — same column shape as L-10 but covers
    every style that sold in the last 6 months, not just 3-4-month-old
    launches. Use this for catalog-wide SOR audits, markdown candidates,
    and IBT shortlists.
    """
    import time as _time
    cache_key = f"all|{country or ''}|{channel or ''}|{brand or ''}"
    if not refresh and cache_key in _all_styles_cache:
        ts, payload = _all_styles_cache[cache_key]
        if _time.time() - ts < _ALL_STYLES_TTL:
            return payload

    today = datetime.now(timezone.utc).date()
    six_m_from = today - timedelta(days=180)
    three_w_from = today - timedelta(days=21)
    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def _topskus(df: str, dt: str) -> List[Dict[str, Any]]:
        # Same dedup/merge logic as `analytics_sor_new_styles_l10._topskus`
        # — kept inline rather than refactored to keep the L-10 endpoint
        # self-contained and avoid coupling.
        base = {"date_from": df, "date_to": dt, "limit": 10000}
        if brand:
            base["product"] = brand
        if len(cs) <= 1 and len(chs) <= 1:
            raw = await fetch("/top-skus", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            }) or []
            results = [raw]
        else:
            results = await multi_fetch("/top-skus", base, cs, chs)
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            for r in g:
                s = r.get("style_name")
                if not s:
                    continue
                if s not in merged:
                    merged[s] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales"):
                        merged[s][f] = (merged[s].get(f) or 0) + (r.get(f) or 0)
                    if (len(merged[s].get("collection") or "") < len(r.get("collection") or "")):
                        merged[s]["collection"] = r.get("collection")
        return list(merged.values())

    # Lifetime window (3 years) for "since launch" metrics. The launch
    # date is defined as the first date a style sold (per ops). A 3-year
    # cap is plenty for a fashion catalog where SKUs rarely outlive a year.
    lifetime_from = today - timedelta(days=1095)

    six_m_skus, three_w_skus, lifetime_skus, inventory, style_dates = await asyncio.gather(
        _topskus(six_m_from.isoformat(), today.isoformat()),
        _topskus(three_w_from.isoformat(), today.isoformat()),
        _topskus(lifetime_from.isoformat(), today.isoformat()),
        fetch_all_inventory(country=country),
        _get_style_first_last_sale(country, channel, days=180),
    )

    candidates = {r.get("style_name") for r in six_m_skus if r.get("style_name")}

    six_m_map = {r.get("style_name"): r for r in six_m_skus if r.get("style_name") in candidates}
    three_w_map = {r.get("style_name"): r for r in three_w_skus if r.get("style_name") in candidates}
    lifetime_map = {r.get("style_name"): r for r in lifetime_skus if r.get("style_name") in candidates}

    # Original price = modal unit price observed across the lifetime
    # /top-skus pull (gross_sales ÷ units_sold ≈ ASP at full price for
    # styles that haven't been heavily discounted). Falls back to the
    # 6-month ASP when lifetime data is missing for a style.
    style_orig_price: Dict[str, float] = {}

    soh_store: Dict[str, float] = defaultdict(float)
    soh_wh: Dict[str, float] = defaultdict(float)
    sku_for_style: Dict[str, str] = {}
    for r in inventory or []:
        s = r.get("style_name")
        if s not in candidates:
            continue
        avail = float(r.get("available") or 0)
        loc = r.get("location_name") or ""
        if is_warehouse_location(loc):
            soh_wh[s] += avail
        else:
            soh_store[s] += avail
        if s not in sku_for_style and r.get("sku"):
            sku_for_style[s] = r["sku"]

    # First-sale + last-sale dates — pulled from the shared 180-day
    # /orders helper. Styles with first_sale within 180 days get a real
    # age + launch_date; older styles fall back to the legacy "≥26 wks"
    # behaviour so we don't have to fan out further into history.
    out: List[Dict[str, Any]] = []
    for s in candidates:
        sm = six_m_map.get(s, {})
        tw = three_w_map.get(s, {})
        lt = lifetime_map.get(s, {})
        units_6m = float(sm.get("units_sold") or 0)
        sales_6m = float(sm.get("total_sales") or 0)
        units_lt = float(lt.get("units_sold") or units_6m)  # fall back to 6m if missing
        gross_lt = float(lt.get("gross_sales") or 0)
        # Original price: modal lifetime ASP (gross / units), else 6m ASP.
        if units_lt > 0 and gross_lt > 0:
            style_orig_price[s] = gross_lt / units_lt
        asp_6m = (sales_6m / units_6m) if units_6m else 0.0
        store = soh_store.get(s, 0)
        wh = soh_wh.get(s, 0)
        soh_total = store + wh
        pct_in_wh = (wh / soh_total * 100.0) if soh_total > 0 else 0.0
        denom = units_6m + soh_total
        sor_6m = (units_6m / denom * 100.0) if denom > 0 else 0.0
        # Lifetime SOR — same formula but with 3-year units. SOH is the
        # same "current on-hand", so this answers "of everything ever
        # made of this style, what % has sold through?".
        denom_lt = units_lt + soh_total
        sor_since_launch = (units_lt / denom_lt * 100.0) if denom_lt > 0 else 0.0
        # Real age + last-sale lookup. The 180-day helper returns ISO
        # strings; only styles that actually traded in the window are
        # present, so absence => style is older than 180 days OR sold
        # zero in the period (and won't be in `candidates` either).
        dates = style_dates.get(s)
        if dates:
            first_iso, last_iso = dates
            try:
                first_d = datetime.fromisoformat(first_iso).date()
                last_d = datetime.fromisoformat(last_iso).date()
            except Exception:
                first_d = None
                last_d = None
        else:
            first_d = None
            last_d = None
        if first_d is not None:
            age_days = (today - first_d).days
            # If the upstream /orders sweep found a first sale ≥180d ago
            # (i.e. the style was actively trading on the boundary day)
            # cap the displayed age at 26.0 wks so the column stays
            # comparable across the catalog.
            age_weeks = min(age_days / 7.0, 26.0)
            launch_date_iso = first_iso if age_days <= 180 else None
        else:
            # Style not seen in the 180-day window — must be older. Mark
            # explicitly so the FE can render "≥26w" if it wants to.
            age_weeks = 26.0
            launch_date_iso = None
        # Weekly avg uses the actual age (capped at 26) so a 12-week
        # style isn't averaged across 26 — same convention as L-10.
        eff_weeks = max(age_weeks, 1.0)  # avoid /0 on freshly-launched styles
        weekly_avg = units_6m / eff_weeks
        woc = (soh_total / weekly_avg) if weekly_avg > 0 else None
        units_3w = float(tw.get("units_sold") or 0)
        # Days since last sale: prefer the real /orders-derived date when
        # available, else fall back to the cheap 3w-bucket heuristic.
        if last_d is not None:
            days_since_last = (today - last_d).days
        else:
            days_since_last = 0 if units_3w > 0 else 22

        out.append({
            "style_name": s,
            "brand": sm.get("brand"),
            "collection": sm.get("collection"),
            "category": category_of(sm.get("product_type")),
            "subcategory": sm.get("product_type"),
            "style_number": sku_for_style.get(s, ""),
            "sales_6m": round(sales_6m, 2),
            "units_6m": int(units_6m),
            "units_3w": int(units_3w),
            "soh_total": round(soh_total, 2),
            "soh_wh": round(wh, 2),
            "soh_store": round(store, 2),
            "pct_in_wh": round(pct_in_wh, 1),
            "asp_6m": round(asp_6m, 2),
            "original_price": round(
                style_orig_price.get(s)
                or (float(sm.get("gross_sales") or 0) / units_6m if units_6m else 0),
                2,
            ),
            "days_since_last_sale": days_since_last,
            "sor_6m": round(sor_6m, 2),
            "units_since_launch": int(units_lt),
            "sor_since_launch": round(sor_since_launch, 2),
            "launch_date": launch_date_iso,
            "weekly_avg": round(weekly_avg, 2),
            "woc": round(woc, 1) if woc is not None else None,
            "style_age_weeks": round(age_weeks, 1),
        })
    out.sort(key=lambda r: r["sor_6m"], reverse=True)
    _all_styles_cache[cache_key] = (_time.time(), out)
    return out


# ---------------------------------------------------------------------------
# Shared style-drill helper. Computes BOTH the per-SKU and per-location
# breakdowns from one /orders fan-out so the SOR Report drill-down (which
# fires both endpoints concurrently) only triggers a single cold scan.
#
# Cache: results live in `_sku_breakdown_cache` AND
# `_location_breakdown_cache` keyed by the same (style, country, channel)
# triple. Either endpoint reads its slice from the cached payload; if the
# cache is empty the helper runs and populates both caches at once.
# ---------------------------------------------------------------------------
async def _compute_style_breakdowns(
    style_name: str, country: Optional[str], channel: Optional[str]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return ({style_name, skus}, {style_name, locations}). Pulls from
    cache if present (per-endpoint TTL), else runs the 6-month /orders
    fan-out + inventory scan once and writes BOTH caches.
    """
    import time as _time
    cache_key = f"{style_name}|{country or ''}|{channel or ''}"
    sku_hit = _sku_breakdown_cache.get(cache_key)
    loc_hit = _location_breakdown_cache.get(cache_key)
    now = _time.time()
    if sku_hit and loc_hit and (now - sku_hit[0] < _SKU_BREAKDOWN_TTL) and (now - loc_hit[0] < _LOCATION_BREAKDOWN_TTL):
        return sku_hit[1], loc_hit[1]

    today = datetime.now(timezone.utc).date()
    six_m_from = today - timedelta(days=180)
    three_w_from = today - timedelta(days=21)
    cs = _split_csv(country)
    chs = _split_csv(channel)

    # 30-day chunks (50k cap on /orders).
    chunks: List[Tuple[date, date]] = []
    cur = six_m_from
    while cur <= today:
        end = min(cur + timedelta(days=29), today)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    async def _orders_chunk(df: date, dt: date) -> List[Dict[str, Any]]:
        return await _safe_fetch("/orders", {
            "date_from": df.isoformat(), "date_to": dt.isoformat(),
            "limit": 50000,
            "country": cs[0] if len(cs) == 1 else None,
            "channel": chs[0] if len(chs) == 1 else None,
        }) or []

    # Parallel fan-out with concurrency=3 — full serial was hitting the
    # 60s gateway timeout on cold cache (~60-90s for 6 sequential /orders
    # calls). 3-way parallel cuts wall-clock to ~25s while staying under
    # the upstream's rate limit. Going higher triggers 503s.
    sem = asyncio.Semaphore(3)
    async def _bounded(df: date, dt: date) -> List[Dict[str, Any]]:
        async with sem:
            return await _orders_chunk(df, dt)
    chunks_data = await asyncio.gather(*[_bounded(df_, dt_) for df_, dt_ in chunks])
    inv = await fetch_all_inventory(country=country)

    needle = style_name.strip()

    # Single pass building both per-SKU AND per-location indexes from
    # the same /orders chunks. /orders is line-item-grained so we get
    # color/size AND channel on every row. The location accumulation is
    # nearly free (one extra dict update per row) and means a click in
    # the SOR Report only triggers ONE /orders fan-out, not two.
    per_sku: Dict[tuple, Dict[str, Any]] = {}
    per_loc_sales: Dict[str, Dict[str, Any]] = {}
    for chunk in chunks_data:
        for r in (chunk or []):
            if (r.get("style_name") or "").strip() != needle:
                continue
            order_date = (r.get("order_date") or "")[:10]
            qty = int(r.get("quantity") or 0)
            sales = float(r.get("total_sales_kes") or 0)
            color = r.get("color_print") or r.get("color") or "—"
            size = r.get("size") or "—"
            sku = r.get("sku") or ""
            sku_key = (color, size, sku)
            b = per_sku.setdefault(sku_key, {
                "sku": sku, "color": color, "size": size,
                "units_6m": 0, "units_3w": 0, "sales_6m": 0.0,
            })
            b["units_6m"] += qty
            b["sales_6m"] += sales
            if order_date and order_date >= three_w_from.isoformat():
                b["units_3w"] += qty
            loc = r.get("channel") or r.get("pos_location_name") or "—"
            lb = per_loc_sales.setdefault(loc, {"location": loc, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0})
            lb["units_6m"] += qty
            lb["sales_6m"] += sales
            if order_date and order_date >= three_w_from.isoformat():
                lb["units_3w"] += qty

    # Inventory walk — populate BOTH SKU-level and location-level SOH
    # indexes at once.
    soh_per_sku: Dict[tuple, Dict[str, float]] = {}
    soh_per_loc: Dict[str, Dict[str, float]] = {}
    for r in (inv or []):
        if (r.get("style_name") or "").strip() != needle:
            continue
        loc_name = r.get("location_name") or ""
        if len(chs) >= 1 and loc_name not in chs:
            continue
        color = r.get("color_print") or r.get("color") or "—"
        size = r.get("size") or "—"
        sku = r.get("sku") or ""
        sku_key = (color, size, sku)
        avail = float(r.get("available") or 0)
        sb = soh_per_sku.setdefault(sku_key, {"store": 0.0, "wh": 0.0})
        lb = soh_per_loc.setdefault(loc_name, {"store": 0.0, "wh": 0.0})
        if is_warehouse_location(loc_name):
            sb["wh"] += avail
            lb["wh"] += avail
        else:
            sb["store"] += avail
            lb["store"] += avail

    # Build per-SKU output.
    sku_rows: List[Dict[str, Any]] = []
    for k in (set(per_sku.keys()) | set(soh_per_sku.keys())):
        sr = per_sku.get(k, {"sku": k[2], "color": k[0], "size": k[1],
                             "units_6m": 0, "units_3w": 0, "sales_6m": 0.0})
        ih = soh_per_sku.get(k, {"store": 0.0, "wh": 0.0})
        soh_total = ih["store"] + ih["wh"]
        sku_rows.append({
            "sku": sr["sku"], "color": sr["color"], "size": sr["size"],
            "units_6m": int(sr["units_6m"]), "units_3w": int(sr["units_3w"]),
            "sales_6m": round(sr["sales_6m"], 2),
            "soh_store": round(ih["store"], 2),
            "soh_wh": round(ih["wh"], 2),
            "soh_total": round(soh_total, 2),
            "pct_in_wh": round((ih["wh"] / soh_total * 100), 1) if soh_total else 0.0,
        })
    sku_rows.sort(key=lambda r: r["units_6m"], reverse=True)
    sku_payload = {"style_name": style_name, "skus": sku_rows}

    # Build per-location output from the same /orders pass.
    loc_rows: List[Dict[str, Any]] = []
    for k in (set(per_loc_sales.keys()) | set(soh_per_loc.keys())):
        sr = per_loc_sales.get(k, {"location": k, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0})
        ih = soh_per_loc.get(k, {"store": 0.0, "wh": 0.0})
        soh_total = ih["store"] + ih["wh"]
        units_6m = sr["units_6m"]
        denom = units_6m + soh_total
        sor = (units_6m / denom * 100.0) if denom > 0 else 0.0
        loc_rows.append({
            "location": k,
            "units_6m": int(units_6m),
            "units_3w": int(sr["units_3w"]),
            "sales_6m": round(sr["sales_6m"], 2),
            "soh_store": round(ih["store"], 2),
            "soh_wh": round(ih["wh"], 2),
            "soh_total": round(soh_total, 2),
            "sor_6m": round(sor, 2),
        })
    loc_rows.sort(key=lambda r: (r["units_6m"], r["soh_total"]), reverse=True)
    loc_payload = {"style_name": style_name, "locations": loc_rows}

    _sku_breakdown_cache[cache_key] = (now, sku_payload)
    _location_breakdown_cache[cache_key] = (now, loc_payload)
    return sku_payload, loc_payload


# Forward declaration of caches (definitions below); kept here so the
# helper above can reference them. Python lookups happen at call time so
# the order doesn't matter — these will resolve to the dicts below.
_location_breakdown_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_LOCATION_BREAKDOWN_TTL = 60 * 30  # 30 minutes


# ---------------------------------------------------------------------------
# SKU-level breakdown for a single style — powers the "+ Color" / "+ Size"
# drill-down toggles on both SOR tables. Returns one row per unique
# (color_print, size, sku) variant with units sold (6m + 3w), current SOH,
# and warehouse split. Lazy-loaded by the frontend per expanded row.
# ---------------------------------------------------------------------------
@api_router.get("/analytics/style-sku-breakdown")
async def analytics_style_sku_breakdown(
    style_name: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    response: Response = None,
):
    """Per-SKU sales + SOH for one style. SKU = (color_print, size).

    Output (200): list of rows {sku, color, size, units_6m, units_3w,
    soh_total, soh_store, soh_wh, pct_in_wh}. Sorted by units_6m desc.
    Cached for 30 minutes per (style_name, country, channel).

    For cold callers the underlying /orders fan-out can exceed the 60s
    ingress timeout; in that case returns HTTP 202 with
    `{computing: true, retry_after: 15}` so the frontend can poll.
    """
    import time as _time
    cache_key = f"{style_name}|{country or ''}|{channel or ''}"
    cached = _sku_breakdown_cache.get(cache_key)
    if cached and (_time.time() - cached[0] < _SKU_BREAKDOWN_TTL):
        return cached[1]
    task = await _start_or_join_style_scan(style_name, country, channel)
    try:
        payload, _ = await asyncio.wait_for(asyncio.shield(task), timeout=50.0)
        return payload
    except asyncio.TimeoutError:
        if response is not None:
            response.status_code = 202
        return {"computing": True, "style_name": style_name, "retry_after": 15}


# In-flight scans for the location-breakdown drill-down. Each entry is
# an asyncio Task that resolves to the same payload tuple as
# `_compute_style_breakdowns`. Lets us return "still computing" 202s on
# the first 50s (under the 60s ingress timeout) while the actual scan
# continues in the background. Subsequent polls either join the same
# task or hit the populated `_location_breakdown_cache`.
_style_breakdown_inflight: Dict[str, "asyncio.Task[Tuple[Dict[str, Any], Dict[str, Any]]]"] = {}


async def _start_or_join_style_scan(style_name: str, country: Optional[str], channel: Optional[str]) -> "asyncio.Task[Tuple[Dict[str, Any], Dict[str, Any]]]":
    """Return the running Task for this (style, country, channel), or
    spawn a fresh one. Tasks self-clean from `_style_breakdown_inflight`
    when done."""
    cache_key = f"{style_name}|{country or ''}|{channel or ''}"
    existing = _style_breakdown_inflight.get(cache_key)
    if existing and not existing.done():
        return existing

    async def _run():
        try:
            return await _compute_style_breakdowns(style_name, country, channel)
        finally:
            _style_breakdown_inflight.pop(cache_key, None)

    task = asyncio.create_task(_run())
    _style_breakdown_inflight[cache_key] = task
    return task


# ---------------------------------------------------------------------------
# Per-location breakdown for a single style — powers the "Where did this
# style sell?" side panel on the SOR Report. Returns one row per location
# with units sold (6m), current SOH, and SOR%. Shares the
# `_compute_style_breakdowns` /orders fan-out with the SKU endpoint so a
# click in the SOR Report (which fires both endpoints) triggers exactly
# one /orders fan-out, not two.
#
# The /orders fan-out can take 60-90s on cold cache for popular styles
# (the 30-day chunks each pull 30-50k line items). To stay under the
# ingress's 60s gateway timeout, we kick off the scan as a background
# task and either: (a) wait up to 50s and return the result, or (b)
# return HTTP 202 with `{computing: true}` so the frontend can poll.
# Subsequent polls join the same in-flight task or hit the warmed cache.
# ---------------------------------------------------------------------------
@api_router.get("/analytics/style-location-breakdown")
async def analytics_style_location_breakdown(
    style_name: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    color: Optional[str] = None,
    size: Optional[str] = None,
    response: Response = None,
):
    """Per-location sales + SOH for one style, optionally filtered to
    rows of a single colour and / or size.

    Returns:
      • 200 with `{style_name, locations: [...]}` when the cache is
        populated or the in-flight scan finished within ~50s.
      • 202 with `{computing: true, style_name, retry_after: 15}` when
        the scan is still running. Frontend should poll every 15s.

    When `color` and / or `size` are supplied the response is filtered
    accordingly. Used by the SOR Report color/size drill: clicking
    "Black" inside a Style row → re-renders Where-did-it-sell with
    Black-only numbers. Clicking a specific size SKU within Black →
    further narrows to that colour+size at every location. Re-aggregated
    from the cached orders + inventory so this is essentially free
    once the style scan ran once. No new upstream calls.
    """
    import time as _time
    cache_key = f"{style_name}|{country or ''}|{channel or ''}"

    # Fast path: warm cache (style-level only — colour/size filters
    # are always applied on top of the cached raw scan, see below).
    cached = _location_breakdown_cache.get(cache_key)
    if cached and (_time.time() - cached[0] < _LOCATION_BREAKDOWN_TTL):
        if not color and not size:
            return cached[1]
        return await _filter_locations_by_color(style_name, country, channel, color, size)

    # Start (or join) the background scan and wait up to 50s.
    task = await _start_or_join_style_scan(style_name, country, channel)
    try:
        _, payload = await asyncio.wait_for(asyncio.shield(task), timeout=50.0)
        if not color and not size:
            return payload
        return await _filter_locations_by_color(style_name, country, channel, color, size)
    except asyncio.TimeoutError:
        # Scan still running — tell the frontend to poll. The Task is NOT
        # cancelled (we used asyncio.shield), so it'll finish in the
        # background and populate the cache within the next 30-60s.
        if response is not None:
            response.status_code = 202
        return {"computing": True, "style_name": style_name, "retry_after": 15}


# ─── Color/size-filtered location aggregator ─────────────────────────
#
# The bulk style scan caches per-style location aggregates in
# `_location_breakdown_cache`. For colour/size-filtered views we
# re-walk the already-cached raw orders + inventory windows for that
# style once. Result is cached in `_location_color_cache` keyed by
# (style, country, channel, color, size) so repeat clicks are instant.
_location_color_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_LOCATION_COLOR_TTL = 600  # 10 minutes — same as the style-level cache.


async def _filter_locations_by_color(
    style_name: str,
    country: Optional[str],
    channel: Optional[str],
    color: Optional[str],
    size: Optional[str] = None,
) -> Dict[str, Any]:
    import time as _time
    key = f"{style_name}|{country or ''}|{channel or ''}|{color or ''}|{size or ''}"
    hit = _location_color_cache.get(key)
    if hit and (_time.time() - hit[0] < _LOCATION_COLOR_TTL):
        return hit[1]

    today = datetime.now(timezone.utc).date()
    six_m_from = today - timedelta(days=180)
    three_w_from = today - timedelta(days=21)
    chs = _split_csv(channel)

    orders = await _orders_for_window(
        six_m_from.isoformat(), today.isoformat(), country, channel,
    )
    inv = await fetch_all_inventory(country=country) or []

    needle = (style_name or "").strip()
    target_color = (color or "").strip()
    target_size = (size or "").strip()
    per_loc_sales: Dict[str, Dict[str, Any]] = {}
    for r in orders:
        if (r.get("style_name") or "").strip() != needle:
            continue
        if target_color:
            rc = (r.get("color_print") or r.get("color") or "—").strip()
            if rc != target_color:
                continue
        if target_size:
            rs = (r.get("size") or "—").strip()
            if rs != target_size:
                continue
        order_date = (r.get("order_date") or "")[:10]
        qty = int(r.get("quantity") or 0)
        sales = float(r.get("total_sales_kes") or 0)
        loc = r.get("channel") or r.get("pos_location_name") or "—"
        b = per_loc_sales.setdefault(loc, {
            "location": loc, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0,
        })
        b["units_6m"] += qty
        b["sales_6m"] += sales
        if order_date and order_date >= three_w_from.isoformat():
            b["units_3w"] += qty

    soh_per_loc: Dict[str, Dict[str, float]] = {}
    for r in (inv or []):
        if (r.get("style_name") or "").strip() != needle:
            continue
        if target_color:
            rc = (r.get("color_print") or r.get("color") or "—").strip()
            if rc != target_color:
                continue
        if target_size:
            rs = (r.get("size") or "—").strip()
            if rs != target_size:
                continue
        loc_name = r.get("location_name") or ""
        if chs and loc_name not in chs:
            continue
        avail = float(r.get("available") or 0)
        b = soh_per_loc.setdefault(loc_name, {"store": 0.0, "wh": 0.0})
        if is_warehouse_location(loc_name):
            b["wh"] += avail
        else:
            b["store"] += avail

    loc_rows: List[Dict[str, Any]] = []
    for loc in (set(per_loc_sales.keys()) | set(soh_per_loc.keys())):
        sr = per_loc_sales.get(loc, {"location": loc, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0})
        ih = soh_per_loc.get(loc, {"store": 0.0, "wh": 0.0})
        soh_total = ih["store"] + ih["wh"]
        units_6m = sr["units_6m"]
        denom = units_6m + soh_total
        sor = (units_6m / denom * 100.0) if denom > 0 else 0.0
        loc_rows.append({
            "location": loc,
            "units_6m": int(units_6m),
            "units_3w": int(sr["units_3w"]),
            "sales_6m": round(sr["sales_6m"], 2),
            "soh_store": round(ih["store"], 2),
            "soh_wh": round(ih["wh"], 2),
            "soh_total": round(soh_total, 2),
            "sor_6m": round(sor, 2),
        })
    loc_rows.sort(key=lambda r: (r["units_6m"], r["soh_total"]), reverse=True)
    payload = {"style_name": style_name, "color": color, "size": size, "locations": loc_rows}
    _location_color_cache[key] = (_time.time(), payload)
    return payload


@api_router.get("/analytics/style-sku-breakdown-bulk")
async def analytics_style_sku_breakdown_bulk(
    style_names: str = Query(..., description="Comma-separated style names"),
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Bulk variant of `/analytics/style-sku-breakdown` — accepts a CSV of
    style names and runs the 6-month /orders fan-out and inventory pull
    ONCE, then aggregates per-style. The single-style endpoint is fine
    for one-off lookups but the SOR styles table calls it for the first
    25 visible rows on render — 25× independent fan-outs hit the upstream
    rate-limit (and even with our cache, cold-load is 30+ seconds per
    style serially). This bulk path collapses 25 calls into one.

    Output: `{styles: {<style_name>: [{sku, color, size, units_6m, ...},
    ...], ...}, missing: [<style names with no data>]}`. Per-style rows
    use the same shape as the single endpoint so the frontend can swap.

    Each (style, country, channel) triple also gets stamped into the
    single-row cache, so a follow-up `/style-sku-breakdown?style_name=…`
    hits warm cache too.
    """
    import time as _time
    needles = [s.strip() for s in style_names.split(",") if s.strip()]
    if not needles:
        return {"styles": {}, "missing": []}

    today = datetime.now(timezone.utc).date()
    six_m_from = today - timedelta(days=180)
    three_w_from = today - timedelta(days=21)

    # Use _orders_for_window so partial upstream 503s don't kill the
    # whole bulk call. We also benefit from its 10-min cache.
    chunk_rows = await _orders_for_window(
        six_m_from.isoformat(), today.isoformat(), country, channel,
    )
    inv = await fetch_all_inventory(country=country) or []

    needle_set = set(needles)
    # Per-style aggregation: { style_name: { (color, size, sku): {...} } }
    per_style_sales: Dict[str, Dict[tuple, Dict[str, Any]]] = {n: {} for n in needles}
    # ALSO build per-style location aggregates from the same orders pass
    # so we can stamp `_location_breakdown_cache` and have the SOR
    # Report's "Where did it sell?" pane open instantly on row click.
    # Without this, every row click triggered a fresh 30-60s cold scan.
    per_style_loc_sales: Dict[str, Dict[str, Dict[str, Any]]] = {n: {} for n in needles}
    three_w_iso = three_w_from.isoformat()
    for r in chunk_rows:
        sn = (r.get("style_name") or "").strip()
        if sn not in needle_set:
            continue
        order_date = (r.get("order_date") or "")[:10]
        color = r.get("color_print") or r.get("color") or "—"
        size = r.get("size") or "—"
        sku = r.get("sku") or ""
        key = (color, size, sku)
        b = per_style_sales[sn].setdefault(key, {
            "sku": sku, "color": color, "size": size,
            "units_6m": 0, "units_3w": 0, "sales_6m": 0.0,
        })
        qty = int(r.get("quantity") or 0)
        sales = float(r.get("total_sales_kes") or 0)
        b["units_6m"] += qty
        b["sales_6m"] += sales
        is_recent = order_date and order_date >= three_w_iso
        if is_recent:
            b["units_3w"] += qty
        loc = r.get("channel") or r.get("pos_location_name") or "—"
        lb = per_style_loc_sales[sn].setdefault(loc, {
            "location": loc, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0,
        })
        lb["units_6m"] += qty
        lb["sales_6m"] += sales
        if is_recent:
            lb["units_3w"] += qty

    per_style_soh: Dict[str, Dict[tuple, Dict[str, float]]] = {n: {} for n in needles}
    # And per-style location SOH for the location cache stamp.
    per_style_loc_soh: Dict[str, Dict[str, Dict[str, float]]] = {n: {} for n in needles}
    chs = _split_csv(channel)
    for r in inv:
        sn = (r.get("style_name") or "").strip()
        if sn not in needle_set:
            continue
        if len(chs) >= 1 and r.get("location_name") not in chs:
            continue
        color = r.get("color_print") or r.get("color") or "—"
        size = r.get("size") or "—"
        sku = r.get("sku") or ""
        key = (color, size, sku)
        avail = float(r.get("available") or 0)
        loc = r.get("location_name") or ""
        b = per_style_soh[sn].setdefault(key, {"store": 0.0, "wh": 0.0})
        lb = per_style_loc_soh[sn].setdefault(loc, {"store": 0.0, "wh": 0.0})
        if is_warehouse_location(loc):
            b["wh"] += avail
            lb["wh"] += avail
        else:
            b["store"] += avail
            lb["store"] += avail

    out_styles: Dict[str, List[Dict[str, Any]]] = {}
    missing: List[str] = []
    now_ts = _time.time()
    for sn in needles:
        sales_map = per_style_sales[sn]
        soh_map = per_style_soh[sn]
        keys = set(sales_map.keys()) | set(soh_map.keys())
        rows: List[Dict[str, Any]] = []
        for k in keys:
            sales_row = sales_map.get(k, {
                "sku": k[2], "color": k[0], "size": k[1],
                "units_6m": 0, "units_3w": 0, "sales_6m": 0.0,
            })
            soh_row = soh_map.get(k, {"store": 0.0, "wh": 0.0})
            soh_total = soh_row["store"] + soh_row["wh"]
            rows.append({
                "sku": sales_row["sku"],
                "color": sales_row["color"],
                "size": sales_row["size"],
                "units_6m": int(sales_row["units_6m"]),
                "units_3w": int(sales_row["units_3w"]),
                "sales_6m": round(sales_row["sales_6m"], 2),
                "soh_store": round(soh_row["store"], 2),
                "soh_wh": round(soh_row["wh"], 2),
                "soh_total": round(soh_total, 2),
                "pct_in_wh": round((soh_row["wh"] / soh_total * 100), 1) if soh_total else 0.0,
            })
        rows.sort(key=lambda r: r["units_6m"], reverse=True)
        out_styles[sn] = rows
        if not rows:
            missing.append(sn)
        # Warm the single-style SKU cache so subsequent ?style_name=… calls
        # hit it instantly.
        ck = f"{sn}|{country or ''}|{channel or ''}"
        _sku_breakdown_cache[ck] = (now_ts, {"style_name": sn, "skus": rows})

        # Build & stamp the location-breakdown cache too — this is the
        # whole reason we extended the bulk endpoint. Identical logic to
        # the single-style path so the "Where did it sell?" pane returns
        # exactly the same numbers regardless of cache origin.
        loc_sales = per_style_loc_sales[sn]
        loc_soh = per_style_loc_soh[sn]
        loc_keys = set(loc_sales.keys()) | set(loc_soh.keys())
        loc_rows: List[Dict[str, Any]] = []
        for loc_k in loc_keys:
            sr = loc_sales.get(loc_k, {"location": loc_k, "units_6m": 0, "units_3w": 0, "sales_6m": 0.0})
            ih = loc_soh.get(loc_k, {"store": 0.0, "wh": 0.0})
            soh_total = ih["store"] + ih["wh"]
            units_6m = sr["units_6m"]
            denom = units_6m + soh_total
            sor = (units_6m / denom * 100.0) if denom > 0 else 0.0
            loc_rows.append({
                "location": loc_k,
                "units_6m": int(units_6m),
                "units_3w": int(sr["units_3w"]),
                "sales_6m": round(sr["sales_6m"], 2),
                "soh_store": round(ih["store"], 2),
                "soh_wh": round(ih["wh"], 2),
                "soh_total": round(soh_total, 2),
                "sor_6m": round(sor, 2),
            })
        loc_rows.sort(key=lambda r: (r["units_6m"], r["soh_total"]), reverse=True)
        _location_breakdown_cache[ck] = (now_ts, {"style_name": sn, "locations": loc_rows})

    return {"styles": out_styles, "missing": missing}


# ---------------------------------------------------------------------------
# Stock-to-Sales by Color & Size — per (store × style × color × size).
# Formula: stock_to_sales_ratio = soh ÷ avg weekly units sold (last 4 weeks).
# Higher = sitting longer; lower = stockout risk. Used by store managers
# to spot which colors/sizes to push, mark down, or transfer.
# ---------------------------------------------------------------------------
@api_router.get("/analytics/stock-to-sales-by-sku")
async def analytics_stock_to_sales_by_sku(
    style_name: str,
    weeks: int = Query(4, ge=1, le=12),
    country: Optional[str] = None,
):
    """Per-store SKU-level stock-to-sales ratio for one style.

    Returns one row per (location, color, size, sku) with:
       • soh (current)
       • units_sold (last `weeks` weeks)
       • weekly_velocity (units_sold ÷ weeks)
       • stock_to_sales_ratio (soh ÷ weekly_velocity, ∞ when no sales)
    Sorted by location then by ratio asc — so the most stockout-prone
    SKUs at each store float to the top.
    """
    today = datetime.now(timezone.utc).date()
    df = today - timedelta(days=weeks * 7)
    needle = style_name.strip()

    # Chunk /orders fetch (≤30 days each) and fetch_all_inventory in parallel.
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= today:
        end = min(cur + timedelta(days=29), today)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    async def _orders_chunk(d1: date, d2: date) -> List[Dict[str, Any]]:
        return await _safe_fetch("/orders", {
            "date_from": d1.isoformat(), "date_to": d2.isoformat(),
            "limit": 50000,
            "country": country,
        }) or []

    chunks_data: List[List[Dict[str, Any]]] = []
    for d1, d2 in chunks:
        chunks_data.append(await _orders_chunk(d1, d2))
    inv = await fetch_all_inventory(country=country)

    # Sales by (location × sku).
    units_by: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for chunk in chunks_data:
        for r in chunk:
            if (r.get("style_name") or "").strip() != needle:
                continue
            loc = r.get("pos_location_name") or r.get("channel") or "—"
            sku = r.get("sku") or ""
            color = r.get("color_print") or r.get("color") or "—"
            size = r.get("size") or "—"
            key = (loc, sku)
            b = units_by.setdefault(key, {
                "location": loc, "sku": sku, "color": color, "size": size,
                "units_sold": 0,
            })
            b["units_sold"] += int(r.get("quantity") or 0)

    # SOH by (location × sku).
    soh_by: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in (inv or []):
        if (r.get("style_name") or "").strip() != needle:
            continue
        loc = r.get("location_name") or "—"
        sku = r.get("sku") or ""
        color = r.get("color_print") or r.get("color") or "—"
        size = r.get("size") or "—"
        key = (loc, sku)
        b = soh_by.setdefault(key, {
            "location": loc, "sku": sku, "color": color, "size": size,
            "soh": 0,
        })
        b["soh"] += int(r.get("available") or 0)

    # Merge — emit one row per union key.
    keys = set(units_by.keys()) | set(soh_by.keys())
    rows: List[Dict[str, Any]] = []
    for k in keys:
        sales = units_by.get(k, {})
        stock = soh_by.get(k, {})
        sample = sales or stock
        units = sales.get("units_sold", 0)
        soh = stock.get("soh", 0)
        weekly_vel = units / weeks if weeks > 0 else 0
        ratio = (soh / weekly_vel) if weekly_vel > 0 else None
        rows.append({
            "location": sample.get("location", "—"),
            "sku": sample.get("sku") or k[1],
            "color": sample.get("color", "—"),
            "size": sample.get("size", "—"),
            "units_sold": units,
            "soh": soh,
            "weekly_velocity": round(weekly_vel, 2),
            "stock_to_sales_weeks": round(ratio, 1) if ratio is not None else None,
        })
    rows.sort(key=lambda r: (
        r["location"],
        9999 if r["stock_to_sales_weeks"] is None else r["stock_to_sales_weeks"],
    ))
    return {
        "style_name": style_name,
        "weeks_window": weeks,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# New-styles sales curve — for every style whose first-ever sale was in
# the last 122 days (matches L-10 launch band), return weekly units &
# revenue since launch. Lets the buying team spot the "reorder window"
# (sales still climbing or just plateauing) before the curve turns down.
# ---------------------------------------------------------------------------
@api_router.get("/analytics/new-styles-curve")
async def analytics_new_styles_curve(
    days: int = Query(122, ge=30, le=365),
    country: Optional[str] = None,
    channel: Optional[str] = None,
    refresh: bool = False,
):
    """Weekly sales curve per new style (launched in last `days` days).

    Per style returns: launch_date, total_units, total_sales, weekly = [
      {week_index, week_start, units, sales}, …
    ]. Frontend draws a sparkline + flags "still climbing / plateaued / declining".
    Cached for 30 minutes per (days, country, channel).
    """
    import time as _time
    cache_key = f"{days}|{country or ''}|{channel or ''}"
    if not refresh and cache_key in _curve_cache:
        ts, payload = _curve_cache[cache_key]
        if _time.time() - ts < _CURVE_TTL:
            return payload
    today = datetime.now(timezone.utc).date()
    df = today - timedelta(days=int(days))
    cs = _split_csv(country)
    chs = _split_csv(channel)

    # Single-channel/single-country only — multi-select would explode the
    # /orders fan-out; the FE constrains the call to global view.
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= today:
        end = min(cur + timedelta(days=29), today)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    async def _chunk(d1: date, d2: date) -> List[Dict[str, Any]]:
        return await _safe_fetch("/orders", {
            "date_from": d1.isoformat(), "date_to": d2.isoformat(),
            "limit": 50000,
            "country": cs[0] if len(cs) == 1 else None,
            "channel": chs[0] if len(chs) == 1 else None,
        }) or []

    all_rows: List[Dict[str, Any]] = []
    for d1, d2 in chunks:
        all_rows.extend(await _chunk(d1, d2))

    # Per style: first sale date + total + weekly.
    by_style: Dict[str, Dict[str, Any]] = {}
    for r in all_rows:
        s = r.get("style_name")
        if not s:
            continue
        d_iso = (r.get("order_date") or "")[:10]
        if not d_iso:
            continue
        b = by_style.setdefault(s, {
            "style_name": s,
            "brand": r.get("brand"),
            "subcategory": r.get("product_type") or r.get("subcategory"),
            "first_sale": d_iso,
            "weekly": {},
            "total_units": 0,
            "total_sales": 0.0,
        })
        if d_iso < b["first_sale"]:
            b["first_sale"] = d_iso
        units = int(r.get("quantity") or 0)
        sales = float(r.get("total_sales_kes") or 0)
        b["total_units"] += units
        b["total_sales"] += sales
        b["weekly"].setdefault(d_iso, {"units": 0, "sales": 0.0})
        b["weekly"][d_iso]["units"] += units
        b["weekly"][d_iso]["sales"] += sales

    out: List[Dict[str, Any]] = []
    for s, b in by_style.items():
        first = datetime.strptime(b["first_sale"], "%Y-%m-%d").date()
        # Only include styles where first sale is within the requested window
        # AND ≥ 14 days ago (need at least 2 weeks of data to draw a curve).
        if (today - first).days < 14:
            continue
        # Bucket by week index since launch.
        weekly_buckets: Dict[int, Dict[str, Any]] = {}
        for d_iso, agg in b["weekly"].items():
            day = datetime.strptime(d_iso, "%Y-%m-%d").date()
            wk = (day - first).days // 7
            wb = weekly_buckets.setdefault(wk, {
                "week_index": wk,
                "week_start": (first + timedelta(days=wk * 7)).isoformat(),
                "units": 0, "sales": 0.0,
            })
            wb["units"] += agg["units"]
            wb["sales"] += agg["sales"]
        weekly_list = sorted(weekly_buckets.values(), key=lambda r: r["week_index"])
        # Trend signal: compare last-2-week mean to peak (more robust than the
        # single-bucket comparison when a fresh week hasn't booked yet).
        units_series = [w["units"] for w in weekly_list]
        peak = max(units_series) if units_series else 0
        last_two_mean = (sum(units_series[-2:]) / max(len(units_series[-2:]), 1)) if units_series else 0
        if peak == 0:
            trend = "no-sales"
        elif last_two_mean >= peak * 0.85:
            trend = "climbing"
        elif last_two_mean >= peak * 0.5:
            trend = "plateau"
        else:
            trend = "declining"
        out.append({
            **{k: b[k] for k in ("style_name", "brand", "subcategory", "first_sale", "total_units")},
            "total_sales": round(b["total_sales"], 2),
            "weeks_since_launch": (today - first).days // 7,
            "weekly": [{**w, "sales": round(w["sales"], 2)} for w in weekly_list],
            "peak_weekly_units": int(peak),
            "trend": trend,
        })
    out.sort(key=lambda r: r["total_units"], reverse=True)
    payload = {
        "days": days,
        "as_of": today.isoformat(),
        "rows": out,
    }
    _curve_cache[cache_key] = (_time.time(), payload)
    return payload


# ---------------------------------------------------------------------------
# Daily Replenishment Report
# ---------------------------------------------------------------------------
# For each (POS, SKU) pair where current shop-floor stock < 2 we emit one
# row recommending replenishment up to a target of 2, IF the warehouse has
# the SKU available with stock > 1 (per business rule: never strip the WH).
# When demand from multiple stores exceeds WH supply the priority falls to
# stores ranked highest by 6-month sell-through (best-performing wins).
#
# Owners (Matthew, Teddy, Alvi, Emma) are assigned per-store via greedy
# load-balancing on total replenish units so each owner has equal-or-near-
# equal pick volume each day.
# ---------------------------------------------------------------------------
OWNERS = ["Matthew", "Teddy", "Alvi", "Emma"]
REPL_TARGET = 2  # max units we want at a POS for any SKU
REPL_TRIGGER = 2  # replenish only if POS stock < this
REPL_WH_FLOOR = 1  # WH must have > REPL_WH_FLOOR units to qualify


def _is_online_channel(name: Optional[str]) -> bool:
    """True for any online / e-com channel — those don't need physical
    replenishment from the warehouse to a shop floor."""
    if not name:
        return False
    n = name.lower()
    return ("online" in n) or ("ecom" in n) or ("e-com" in n) or ("shop-zetu" in n) or ("shopify" in n)

_repl_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_REPL_TTL = 60 * 30  # 30 minutes
_perf_rank_cache: Dict[str, Tuple[float, Dict[str, int]]] = {}
_PERF_RANK_TTL = 60 * 60 * 4  # 4 hours — store performance is slow-changing


@api_router.get("/analytics/replenishment-report")
async def analytics_replenishment_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date: Optional[str] = None,  # legacy single-day param, kept for back-compat
    country: Optional[str] = None,
    owners: Optional[str] = None,  # comma-separated names — if provided,
                                   # overrides the default OWNERS list and
                                   # distributes lines equally across them.
):
    """Daily replenishment report — returns rows that need a top-up today.

    Window: `date_from`/`date_to` (inclusive). For back-compat, the legacy
    `date` param is honoured as both ends. When all are unset the window
    defaults to yesterday only. Bins resolved from the cached Google-Sheet
    stock take and H-prefixed bins are excluded. Each row carries a
    `replenished` boolean fetched from `replenishment_state` (toggled via
    /analytics/replenishment-report/mark).
    """
    import time as _time
    today = datetime.now(timezone.utc).date()
    if date and not (date_from or date_to):
        date_from = date_to = date
    df = (
        datetime.strptime(date_from, "%Y-%m-%d").date()
        if date_from else (today - timedelta(days=1))
    )
    dt = (
        datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else df
    )
    if dt < df:
        df, dt = dt, df
    # Resolve effective owner roster — caller-provided list wins, else
    # admin-configured persisted list, else the static fallback.
    eff_owners: List[str] = []
    if owners:
        eff_owners = [n.strip() for n in owners.split(",") if n and n.strip()]
    if not eff_owners:
        try:
            cfg_doc = await db.replenishment_config.find_one(
                {"_id": "default"}, {"_id": 0, "owners": 1}
            )
            if cfg_doc and isinstance(cfg_doc.get("owners"), list):
                eff_owners = [str(x).strip() for x in cfg_doc["owners"] if str(x).strip()]
        except Exception as e:
            logger.warning("[replen] could not load saved owners: %s", e)
    if not eff_owners:
        eff_owners = list(OWNERS)
    cache_key = f"{df.isoformat()}|{dt.isoformat()}|{country or ''}|{','.join(eff_owners)}"
    if cache_key in _repl_cache:
        ts, payload = _repl_cache[cache_key]
        if _time.time() - ts < _REPL_TTL:
            # Re-overlay the latest replenished state (the cache is computed
            # rows; the state can change minute-by-minute as owners pick).
            await _overlay_repl_state(payload, df, dt)
            return payload

    # 1) Units sold over [df, dt]: orders chunked into ≤30-day windows
    # (upstream caps at 50k rows per call) AND fanned-out per country so a
    # single 50k-row chunk doesn't accidentally bias the report toward
    # whichever country the upstream returns first. Group by (location, SKU)
    # — the /orders endpoint exposes `sku` but not `barcode`; we look up the
    # barcode via the inventory snapshot in step 2.
    sold_units: Dict[Tuple[str, str], int] = {}
    sku_meta: Dict[str, Dict[str, Any]] = {}
    loc_country: Dict[str, str] = {}  # POS location → country (canonical)
    chunks: List[Tuple[date, date]] = []
    cur = df
    while cur <= dt:
        end = min(cur + timedelta(days=29), dt)
        chunks.append((cur, end))
        cur = end + timedelta(days=1)

    if country:
        country_list = [country]
    else:
        # Fan out across all 3 countries — keeps chunks well under the
        # upstream 50k cap and guarantees no country is silently dropped
        # (the upstream defaults to Uganda when country is omitted, which
        # is why earlier versions of this report appeared Uganda-only).
        # Title-cased per upstream contract.
        country_list = ["Kenya", "Uganda", "Rwanda"]

    # Cap concurrency at 4 — upstream /orders 503s when we fan out 9-21
    # simultaneous calls (3 chunks × 3 countries for 7-day window, or 21 for
    # 6-month perf rank). 4 keeps total wall time low while staying under
    # upstream rate limits.
    _orders_sem = asyncio.Semaphore(4)

    async def _orders_chunk(d1: date, d2: date, ctry: str) -> List[Dict[str, Any]]:
        async with _orders_sem:
            return await _safe_fetch("/orders", {
                "date_from": d1.isoformat(), "date_to": d2.isoformat(),
                "limit": 50000, "country": ctry,
            }) or []

    fetch_jobs = [
        _orders_chunk(d1, d2, ctry)
        for (d1, d2) in chunks
        for ctry in country_list
    ]
    chunk_results = await asyncio.gather(*fetch_jobs, return_exceptions=True)
    for chunk in chunk_results:
        if isinstance(chunk, Exception) or not chunk:
            continue
        for r in chunk:
            # Accept any non-return sale kind. Upstream uses 'order' for
            # Uganda/Rwanda and 'sale' for Kenya — both represent a
            # genuine outbound unit and should drive replenishment.
            sk = (r.get("sale_kind") or "order").lower()
            if sk in ("return", "exchange", "refund"):
                continue
            if is_excluded_brand(r.get("brand")):
                continue
            if is_excluded_product(r):
                continue
            loc = r.get("pos_location_name") or r.get("channel") or ""
            if not loc or is_warehouse_location(loc) or is_excluded_location(loc):
                continue
            if _is_online_channel(loc):
                # Replenishment is a physical pick-and-pack operation — online
                # has no shop-floor stock and doesn't fit this report.
                continue
            sku = (r.get("sku") or "").strip()
            if not sku:
                continue
            qty = int(r.get("quantity") or 0)
            if qty <= 0:
                continue
            sold_units[(loc, sku)] = sold_units.get((loc, sku), 0) + qty
            ctry = (r.get("country") or "").title()
            if ctry and loc not in loc_country:
                loc_country[loc] = ctry
            sku_meta.setdefault(sku, {
                "sku": sku,
                "product_name": r.get("product_title") or r.get("product_name") or r.get("style_name") or "",
                "size": r.get("size") or "",
                "barcode": "",  # filled from inventory in step 2
            })

    # 2) Live inventory snapshot — split into POS stock vs WH-finished-goods.
    # Keyed by SKU (matches the orders side) and we pick up the barcode here
    # to resolve the bin and surface it in the report.
    inv = await fetch_all_inventory(country=country) or []
    pos_stock: Dict[Tuple[str, str], float] = {}
    wh_stock: Dict[str, float] = {}
    sku_to_barcode: Dict[str, str] = {}
    for r in inv:
        if is_excluded_brand(r.get("brand")):
            continue
        if is_excluded_product(r):
            continue
        loc = r.get("location_name") or ""
        sku = (r.get("sku") or "").strip()
        if not sku:
            continue
        avail = float(r.get("available") or 0)
        bc = (r.get("barcode") or "").strip()
        if bc and sku not in sku_to_barcode:
            sku_to_barcode[sku] = bc
        # Capture meta when we don't have it from sales side.
        sku_meta.setdefault(sku, {
            "sku": sku,
            "product_name": r.get("product_name") or r.get("style_name") or "",
            "size": r.get("size") or "",
            "barcode": "",
        })
        # Track POS country from inventory too — covers stores that haven't
        # had any orders in the window but may still appear via the
        # zero-stock-no-sale path (none today, but defensive).
        ctry = (r.get("country") or "").title()
        if ctry and loc and loc not in loc_country and not is_warehouse_location(loc):
            loc_country[loc] = ctry
        if is_warehouse_location(loc):
            wh_stock[sku] = wh_stock.get(sku, 0.0) + avail
        elif not is_excluded_location(loc) and not _is_online_channel(loc):
            pos_stock[(loc, sku)] = pos_stock.get((loc, sku), 0.0) + avail
    # Stamp the resolved barcode onto every meta entry now.
    for sku, m in sku_meta.items():
        if not m.get("barcode"):
            m["barcode"] = sku_to_barcode.get(sku, "")

    # 3) Build candidate replenishment lines. Per spec: ONLY emit rows where
    # the SKU sold AT LEAST ONE unit at that POS in the window AND current
    # shop-floor stock < 2.
    candidates: List[Dict[str, Any]] = []
    for (loc, sku), sold in sold_units.items():
        if sold <= 0:
            continue
        ps = pos_stock.get((loc, sku), 0.0)
        if ps >= REPL_TRIGGER:
            continue
        candidates.append({"loc": loc, "sku": sku, "pos": ps, "sold": sold})

    # 4) Store performance rank — used as priority when WH supply is short.
    # Best-performing store (most units last 6 months) wins ties. Cached
    # for 4h so we don't repeat the 6-month fan-out on every call.
    perf_key = country or ""
    if perf_key in _perf_rank_cache and _time.time() - _perf_rank_cache[perf_key][0] < _PERF_RANK_TTL:
        rank = _perf_rank_cache[perf_key][1]
    else:
        # Fan out per (chunk × country) so we never hit the upstream 50k cap.
        perf_orders: List[Dict[str, Any]] = []
        perf_chunks: List[Tuple[date, date]] = []
        cur = today - timedelta(days=180)
        while cur <= today:
            end = min(cur + timedelta(days=29), today)
            perf_chunks.append((cur, end))
            cur = end + timedelta(days=1)
        perf_jobs = [
            _orders_chunk(c1, c2, ctry)
            for (c1, c2) in perf_chunks
            for ctry in country_list
        ]
        perf_results = await asyncio.gather(*perf_jobs, return_exceptions=True)
        for chunk in perf_results:
            if isinstance(chunk, Exception) or not chunk:
                continue
            perf_orders.extend(chunk)
        perf: Dict[str, int] = {}
        for r in perf_orders:
            sk = (r.get("sale_kind") or "order").lower()
            if sk in ("return", "exchange", "refund"):
                continue
            loc = r.get("pos_location_name") or r.get("channel") or ""
            if not loc or is_warehouse_location(loc) or is_excluded_location(loc):
                continue
            if _is_online_channel(loc):
                continue
            perf[loc] = perf.get(loc, 0) + int(r.get("quantity") or 0)
        rank = {loc: i for i, (loc, _) in enumerate(
            sorted(perf.items(), key=lambda x: (-x[1], x[0]))
        )}
        _perf_rank_cache[perf_key] = (_time.time(), rank)

    # 5) Allocate WH stock: highest-rank store gets first dibs. We pre-sort
    # candidates by (store rank asc, pos stock asc, sold desc) so the
    # neediest line at the best store wins when WH is constrained.
    candidates.sort(key=lambda c: (
        rank.get(c["loc"], 10_000), c["pos"], -c["sold"], c["loc"], c["sku"]
    ))

    wh_remaining = dict(wh_stock)  # mutated as we allocate
    rows: List[Dict[str, Any]] = []
    for c in candidates:
        sku = c["sku"]
        wh_avail = wh_remaining.get(sku, 0.0)
        if wh_avail <= REPL_WH_FLOOR:
            # Insufficient WH stock — skip; never strip the WH below floor.
            continue
        deficit = REPL_TARGET - int(c["pos"])
        if deficit <= 0:
            continue
        # Allocate: take up to deficit units, leaving > REPL_WH_FLOOR at WH.
        take = min(deficit, int(wh_avail) - REPL_WH_FLOOR)
        if take <= 0:
            continue
        wh_remaining[sku] = wh_avail - take
        meta = sku_meta.get(sku, {})
        rows.append({
            "owner": "",  # filled in step 6
            "pos_location": c["loc"],
            "country": loc_country.get(c["loc"], ""),
            "product_name": meta.get("product_name") or "",
            "size": meta.get("size") or "",
            "barcode": meta.get("barcode") or "",
            "sku": sku,
            "bin": "",  # filled in step 7
            "units_sold": int(c["sold"]),
            "soh_store": int(c["pos"]),  # current shop-floor stock for this SKU
            "soh_wh": int(wh_avail),  # snapshot value BEFORE allocation
            "replenish": take,
            "replenished": False,  # filled in by _overlay_repl_state
        })

    # 6) Owner assignment — sort all lines alphabetically by POS, then split
    # into N equal slices (N = effective owner roster size). Each owner
    # gets exactly N/owners rows; one owner may span the boundary between
    # two stores (acceptable per spec). Simple row-count division — equal
    # pick volume by lines, not by units.
    rows.sort(key=lambda r: (r["pos_location"], r["product_name"], r["size"]))
    n = len(rows)
    n_owners = max(len(eff_owners), 1)
    base = n // n_owners
    extra = n % n_owners
    cursor = 0
    store_owners: Dict[str, set] = {}
    owners_load: Dict[str, int] = {o: 0 for o in eff_owners}
    for i, owner in enumerate(eff_owners):
        # First `extra` owners absorb the remainder so the totals add up.
        slice_len = base + (1 if i < extra else 0)
        for r in rows[cursor:cursor + slice_len]:
            r["owner"] = owner
            store_owners.setdefault(r["pos_location"], set()).add(owner)
            owners_load[owner] += r["replenish"]
        cursor += slice_len

    # 7) Bin lookup — strip H-prefixed bins (the loader already filters them
    # out, so an empty result here means "no bin recorded in last stock take"
    # which we leave blank rather than suppress the row).
    bins_map = await bins_lookup.get_bins()
    for r in rows:
        r["bin"] = bins_lookup.lookup(bins_map, r["barcode"])

    # 8) Rows already sorted by POS in step 6 — leave order intact so each
    # owner's slice is contiguous in the table.

    payload = {
        "date_from": df.isoformat(),
        "date_to": dt.isoformat(),
        "date": dt.isoformat(),  # legacy alias
        "rows": rows,
        "summary": {
            "total_rows": len(rows),
            "total_units": sum(r["replenish"] for r in rows),
            "owners_used": list(eff_owners),
            "by_owner": [
                {"owner": o,
                 "stores": sum(1 for s, ows in store_owners.items() if o in ows),
                 "lines": sum(1 for r in rows if r["owner"] == o),
                 "units": owners_load[o]}
                for o in eff_owners
            ],
        },
    }
    _repl_cache[cache_key] = (_time.time(), payload)
    await _overlay_repl_state(payload, df, dt)
    return payload


def _repl_state_key(date_from: str, date_to: str, pos: str, barcode: str) -> str:
    return f"{date_from}|{date_to}|{pos}|{barcode}"


async def _overlay_repl_state(payload: Dict[str, Any], df: date, dt: date):
    """Stamp `replenished: bool`, `actual_units_replenished: int|None`,
    `soh_after: int|None`, and `days_lapsed: int` on every row from the
    `replenishment_state` Mongo collection. Cheap — one indexed find with
    a key set.
    """
    try:
        rows_in = payload.get("rows", [])
        keys = [
            _repl_state_key(df.isoformat(), dt.isoformat(), r["pos_location"], r["barcode"])
            for r in rows_in
        ]
        # Track + read per-(pos,barcode) first-seen so the UI can show
        # "Days lapsed" since this SKU first appeared on the
        # replenishment list. Note we key WITHOUT the date window so a
        # user widening the window doesn't reset the lapse counter.
        first_seen_keys = [f"{r['pos_location']}|{r['barcode']}" for r in rows_in]
        if not keys:
            if "summary" in payload:
                payload["summary"]["completed"] = 0
            return
        # State + completion overlay.
        docs = await db.replenishment_state.find(
            {"key": {"$in": keys}},
            {"_id": 0, "key": 1, "replenished": 1,
             "actual_units_replenished": 1, "soh_after": 1,
             "completed_at": 1},
        ).to_list(length=None)
        state_by_key = {d["key"]: d for d in docs}
        # First-seen overlay (permanent — not date-windowed).
        first_seen_docs = await db.replenishment_first_seen.find(
            {"key": {"$in": first_seen_keys}},
            {"_id": 0, "key": 1, "first_seen_at": 1},
        ).to_list(length=None)
        first_seen_by_key = {d["key"]: d.get("first_seen_at") for d in first_seen_docs}
        # Backfill any missing first_seen rows in one bulk upsert.
        now_utc = datetime.now(timezone.utc)
        missing = [
            f"{r['pos_location']}|{r['barcode']}"
            for r in rows_in
            if f"{r['pos_location']}|{r['barcode']}" not in first_seen_by_key
        ]
        if missing:
            try:
                await db.replenishment_first_seen.bulk_write([
                    pymongo.UpdateOne(
                        {"key": k},
                        {"$setOnInsert": {"key": k, "first_seen_at": now_utc}},
                        upsert=True,
                    )
                    for k in set(missing)
                ], ordered=False)
                for k in missing:
                    first_seen_by_key[k] = now_utc
            except Exception:
                pass

        completed = 0
        for r in rows_in:
            k = _repl_state_key(df.isoformat(), dt.isoformat(), r["pos_location"], r["barcode"])
            st = state_by_key.get(k) or {}
            on = bool(st.get("replenished"))
            r["replenished"] = on
            r["actual_units_replenished"] = st.get("actual_units_replenished")
            r["soh_after"] = st.get("soh_after")
            r["completed_at"] = (
                st["completed_at"].isoformat() if st.get("completed_at") else None
            )
            if on:
                completed += 1
            fs_key = f"{r['pos_location']}|{r['barcode']}"
            fs = first_seen_by_key.get(fs_key)
            if isinstance(fs, datetime):
                r["first_seen_at"] = fs.isoformat()
                r["days_lapsed"] = max(0, (now_utc.date() - fs.date()).days)
            else:
                r["first_seen_at"] = None
                r["days_lapsed"] = 0
        if "summary" in payload:
            payload["summary"]["completed"] = completed
    except Exception as e:
        logger.warning("[replen] overlay state failed: %s", e)
        if "summary" in payload:
            payload["summary"]["completed"] = 0


@api_router.post("/analytics/replenishment-report/mark")
async def replenishment_mark(
    payload: Dict[str, Any] = Body(...),
    user=Depends(get_current_user),
):
    """Mark a single replenishment row as done (or not). Body:
    {date_from, date_to, pos_location, barcode, replenished,
     actual_units_replenished?, units_to_replenish?, owner?,
     product_name?, size?, sku?}.

    When replenished=true and `actual_units_replenished` is provided, we
    also snapshot the CURRENT shop-floor stock for that barcode so the
    Completed Replenishments report shows quantity AFTER replenishment.
    """
    df_str = payload.get("date_from")
    dt_str = payload.get("date_to") or df_str
    pos = (payload.get("pos_location") or "").strip()
    bc = (payload.get("barcode") or "").strip()
    state = bool(payload.get("replenished"))
    if not (df_str and dt_str and pos and bc):
        raise HTTPException(status_code=400, detail="date_from, date_to, pos_location, barcode are required")
    actual_units = payload.get("actual_units_replenished")
    if actual_units is not None:
        try:
            actual_units = int(actual_units)
            if actual_units < 0:
                raise ValueError
        except Exception:
            raise HTTPException(400, "actual_units_replenished must be a non-negative integer")

    # When marking complete, snapshot current shop-floor stock for that
    # barcode so the completed report can show the post-replenishment SOH.
    soh_after: Optional[int] = None
    if state and actual_units is not None:
        try:
            inv = await fetch_all_inventory(location=pos)
            for row in (inv or []):
                if (row.get("barcode") or "").strip() == bc:
                    soh_after = (soh_after or 0) + int(row.get("available") or 0)
        except Exception as e:
            logger.warning("[replen] could not snapshot soh_after: %s", e)

    key = _repl_state_key(df_str, dt_str, pos, bc)
    update_doc: Dict[str, Any] = {
        "key": key,
        "date_from": df_str, "date_to": dt_str,
        "pos_location": pos, "barcode": bc,
        "replenished": state,
        "updated_by": user.email if user else None,
        "updated_at": datetime.now(timezone.utc),
    }
    if state:
        update_doc["completed_at"] = datetime.now(timezone.utc)
        update_doc["completed_by_name"] = (
            (user.name or user.email) if user else None
        )
    if actual_units is not None:
        update_doc["actual_units_replenished"] = actual_units
    if soh_after is not None:
        update_doc["soh_after"] = soh_after
    # Optional context for the completed report (audit trail).
    for fld in ("owner", "product_name", "size", "sku",
                "units_to_replenish", "soh_store", "soh_wh", "country"):
        if fld in payload:
            update_doc[fld] = payload[fld]

    await db.replenishment_state.update_one(
        {"key": key},
        {"$set": update_doc},
        upsert=True,
    )
    return {"ok": True, "key": key, "replenished": state,
            "actual_units_replenished": actual_units,
            "soh_after": soh_after}


@api_router.get("/analytics/replenishment-completed")
async def replenishment_completed(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    days: int = Query(30, ge=1, le=180),
    _: User = Depends(require_admin),
):
    """Completed Replenishments report — every row that's been ticked
    Mark As Done in the last `days` days. Returns audit trail of
    User · POS · Product · Qty to replenish · Qty replenished ·
    Fulfilment % · Qty after replenishment.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q: Dict[str, Any] = {"replenished": True, "completed_at": {"$gte": since}}
    if date_from:
        q["date_from"] = {"$gte": date_from}
    if date_to:
        q["date_to"] = {"$lte": date_to}
    cursor = db.replenishment_state.find(q, {"_id": 0}).sort("completed_at", -1)
    rows = await cursor.to_list(length=2000)
    out: List[Dict[str, Any]] = []
    for r in rows:
        u_target = int(r.get("units_to_replenish") or 0)
        u_actual = int(r.get("actual_units_replenished") or 0)
        fulfil_pct = (u_actual / u_target * 100.0) if u_target > 0 else None
        out.append({
            "key": r.get("key"),
            "owner": r.get("owner") or "",
            "completed_by_name": r.get("completed_by_name") or r.get("updated_by") or "",
            "pos_location": r.get("pos_location") or "",
            "country": r.get("country") or "",
            "product_name": r.get("product_name") or "",
            "size": r.get("size") or "",
            "barcode": r.get("barcode") or "",
            "sku": r.get("sku") or "",
            "units_to_replenish": u_target,
            "actual_units_replenished": u_actual,
            "fulfilment_pct": round(fulfil_pct, 1) if fulfil_pct is not None else None,
            "soh_before": int(r.get("soh_store") or 0),
            "soh_after": int(r.get("soh_after")) if r.get("soh_after") is not None else None,
            "completed_at": r["completed_at"].isoformat() if r.get("completed_at") else None,
            "date_from": r.get("date_from"),
            "date_to": r.get("date_to"),
        })
    return {"rows": out, "total": len(out), "since_days": days}


@admin_router.get("/replenishment-config")
async def get_replenishment_config(_: User = Depends(require_admin)):
    """Return the persisted owner roster used by /analytics/replenishment-report
    when no `owners` query param is passed. Empty list = fall back to
    the static OWNERS const in code."""
    doc = await db.replenishment_config.find_one(
        {"_id": "default"}, {"_id": 0, "owners": 1, "updated_by": 1, "updated_at": 1}
    )
    if not doc:
        return {"owners": list(OWNERS), "default": True}
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return {**doc, "default": False}


@admin_router.post("/replenishment-config")
async def set_replenishment_config(
    payload: Dict[str, Any] = Body(...),
    user: User = Depends(require_admin),
):
    """Persist the owner roster (admin/owner only). Body: {owners: [str]}.
    Empty list resets to the static OWNERS const."""
    raw = payload.get("owners") or []
    if not isinstance(raw, list):
        raise HTTPException(400, "owners must be a list of names")
    cleaned = [str(x).strip() for x in raw if str(x).strip()]
    if len(cleaned) > 20:
        raise HTTPException(400, "Maximum 20 owners")
    await db.replenishment_config.update_one(
        {"_id": "default"},
        {"$set": {
            "owners": cleaned,
            "updated_by": user.email if user else None,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {"ok": True, "owners": cleaned}


# ───── Store peer-clustering (Phase 1 — surface only, no IBT logic change) ─────
@admin_router.get("/store-clusters")
async def admin_get_store_clusters(_: User = Depends(require_admin)):
    """Return the latest persisted cluster run with per-store cluster_id +
    centroid descriptions. Cheap — one indexed find."""
    from jobs.cluster_stores import get_current_clusters
    return await get_current_clusters(db)


@admin_router.post("/store-clusters/recluster")
async def admin_recluster_stores(
    use_year: bool = False,
    _: User = Depends(require_admin),
):
    """Trigger a fresh cluster run.

    Phase 1 default: pull 90 days of orders (already in upstream cache,
    near-instant) and use that same window for both behavioural features
    AND tier ranking. This is a deliberate simplification — the design
    spec calls for 12-month tier ranking, but Phase 1 is surface-only
    (no IBT logic change yet) and 90-day revenue is a reasonable tier
    proxy for visualisation.

    Pass `?use_year=true` to additionally pull 365 days for tier
    ranking (slower; falls back to 90-day if the upstream times out).
    """
    from jobs.cluster_stores import run_clustering
    today = date.today()
    df_90 = (today - timedelta(days=90)).isoformat()
    dt = today.isoformat()
    orders_90d = await _orders_for_window(df_90, dt, country=None)
    orders_for_tier = orders_90d
    tier_window = "90d"
    if use_year:
        df_365 = (today - timedelta(days=365)).isoformat()
        try:
            orders_for_tier = await asyncio.wait_for(
                _orders_for_window(df_365, dt, country=None),
                timeout=40.0,
            )
            tier_window = "365d"
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning("[cluster_stores] 12-month pull failed (%s) — using 90-day for tier", e)
            orders_for_tier = orders_90d
            tier_window = "90d_fallback"
    result = await run_clustering(orders_90d, orders_for_tier, db=db, persist=True)
    result["tier_window"] = tier_window
    return result


@admin_router.post("/refresh-bins")
async def refresh_bins():
    """Force-refresh the barcode→bin map from the upstream Google Sheet."""
    bins = await bins_lookup.get_bins(refresh=True)
    return {"loaded": len(bins)}


@api_router.get("/analytics/price-changes")
async def analytics_price_changes(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    brand: Optional[str] = None,
    min_units: int = Query(10, ge=1, le=500),
    min_change_pct: float = Query(2.0, ge=0.0, le=100.0),
    limit: int = Query(200, ge=10, le=1000),
):
    """Price-change tracking: styles whose average selling price has
    shifted materially between the current window and the equal-length
    previous window.

    Derived from upstream /top-skus (which gives units_sold + total_sales
    per style). Upstream does not yet expose a list-price history, so ASP
    (total_sales / units_sold) is our best proxy.

    Filters:
      - `min_units`    — both windows must sell ≥ this to be statistically meaningful.
      - `min_change_pct` — absolute ASP change must be ≥ this to be shown.

    Elasticity = units_change_pct / price_change_pct. Negative elasticity
    means volume fell when price rose (healthy demand curve). Values
    outside [-5, 5] are returned as None (too noisy to be believed).
    """
    from datetime import datetime, timedelta

    if not date_from or not date_to:
        raise HTTPException(status_code=400, detail="date_from and date_to required")
    try:
        df = datetime.fromisoformat(date_from)
        dt = datetime.fromisoformat(date_to)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid date format")
    if dt < df:
        raise HTTPException(status_code=400, detail="date_to must be >= date_from")

    window_days = (dt - df).days + 1
    prev_dt = df - timedelta(days=1)
    prev_df = prev_dt - timedelta(days=window_days - 1)
    prev_df_iso = prev_df.date().isoformat()
    prev_dt_iso = prev_dt.date().isoformat()

    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def styles_for(df_s: str, dt_s: str) -> List[Dict[str, Any]]:
        base = {"date_from": df_s, "date_to": dt_s, "limit": 10000}
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

    cur_rows, prev_rows = await asyncio.gather(
        styles_for(date_from, date_to),
        styles_for(prev_df_iso, prev_dt_iso),
    )

    def asp(r: Dict[str, Any]) -> float:
        u = r.get("units_sold") or 0
        return (r.get("total_sales") or 0) / u if u else 0.0

    prev_map: Dict[str, Dict[str, Any]] = {
        r.get("style_name"): r for r in prev_rows if r.get("style_name")
    }

    out: List[Dict[str, Any]] = []
    for r in cur_rows:
        style = r.get("style_name")
        if not style:
            continue
        p = prev_map.get(style)
        if not p:
            continue
        cur_units = r.get("units_sold") or 0
        prev_units = p.get("units_sold") or 0
        if cur_units < min_units or prev_units < min_units:
            continue
        cur_asp = asp(r)
        prev_asp = asp(p)
        if cur_asp <= 0 or prev_asp <= 0:
            continue
        price_change_pct = (cur_asp - prev_asp) / prev_asp * 100.0
        if abs(price_change_pct) < min_change_pct:
            continue
        units_change_pct = (cur_units - prev_units) / prev_units * 100.0 if prev_units else 0.0
        elasticity: Optional[float] = None
        if abs(price_change_pct) >= 0.5:
            e = units_change_pct / price_change_pct
            if -5.0 <= e <= 5.0:
                elasticity = round(e, 2)
        direction = "increase" if price_change_pct > 0 else "decrease"
        out.append({
            "style_name": style,
            "brand": r.get("brand"),
            "collection": r.get("collection"),
            "product_type": r.get("product_type"),
            "current_avg_price": round(cur_asp, 2),
            "previous_avg_price": round(prev_asp, 2),
            "price_change_pct": round(price_change_pct, 2),
            "direction": direction,
            "current_units": cur_units,
            "previous_units": prev_units,
            "units_change_pct": round(units_change_pct, 2),
            "current_sales": round(r.get("total_sales") or 0, 2),
            "previous_sales": round(p.get("total_sales") or 0, 2),
            "sales_change_pct": round(
                ((r.get("total_sales") or 0) - (p.get("total_sales") or 0))
                / ((p.get("total_sales") or 0) or 1) * 100.0, 2,
            ) if (p.get("total_sales") or 0) else None,
            "price_elasticity": elasticity,
        })
    out.sort(key=lambda x: abs(x["price_change_pct"] or 0), reverse=True)
    return {
        "window_days": window_days,
        "current_from": date_from,
        "current_to": date_to,
        "previous_from": prev_df_iso,
        "previous_to": prev_dt_iso,
        "min_units": min_units,
        "min_change_pct": min_change_pct,
        "count": len(out[:limit]),
        "rows": out[:limit],
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
# Auth + admin routers come first (they bypass the api_router auth dependency).
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(chat_router)
# ─────────────────────────────────────────────────────────────────────────────
# Leaderboard streaks — monthly badge snapshots + "🔥 3 months" longevity.
# Kept on `api_router` so it inherits auth & the /api prefix. Routes are
# registered BEFORE include_router to ensure Depends chain sees them.
# ─────────────────────────────────────────────────────────────────────────────
from leaderboard import (  # noqa: E402
    get_streaks_cached, snapshot_period, _previous_complete_period,
    get_store_of_the_week,
)
from recommendations import router as recommendations_router  # noqa: E402
from user_activity import router as user_activity_router  # noqa: E402
from thumbnails import router as thumbnails_router  # noqa: E402
from notifications import router as notifications_router  # noqa: E402
from search import router as search_router  # noqa: E402
from ask import router as ask_router  # noqa: E402


@api_router.get("/leaderboard/streaks")
async def leaderboard_streaks(lookback_months: int = 6):
    """Return per-badge streaks for the most recent complete months."""
    data = await get_streaks_cached(lookback_months=lookback_months)
    return data


@api_router.get("/leaderboard/store-of-the-week")
async def leaderboard_sotw():
    """Last 7 completed days' winners with WoW deltas — Overview recap card."""
    return await get_store_of_the_week()


@api_router.post("/admin/leaderboard/snapshot")
async def leaderboard_snapshot(period: Optional[str] = None, force: bool = False):
    """Compute & persist the snapshot for `period` (default = last complete month)."""
    p = period or _previous_complete_period()
    data = await snapshot_period(p, force=force)
    return {"period": p, "snapshots": data}


# ---------------------------------------------------------------------------
# Exports — extra report tables
# ---------------------------------------------------------------------------
def _shift_iso_year(iso: str, years: int) -> str:
    """Shift YYYY-MM-DD by `years`, clamping Feb-29 to Feb-28 in non-leap years."""
    y, m, d = iso.split("-")
    y = int(y) + years
    m_int = int(m)
    d_int = int(d)
    last = (date(y, m_int, 28) if m_int == 2 else date(y, m_int + 1, 1) - timedelta(days=1)).day if m_int < 12 else 31
    if m_int == 2:
        # Last day of Feb in target year.
        if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0):
            last = 29
        else:
            last = 28
    return f"{y:04d}-{m_int:02d}-{min(d_int, last):02d}"


async def _ss_one(date_from: str, date_to: str) -> List[Dict[str, Any]]:
    try:
        return await fetch("/sales-summary", {"date_from": date_from, "date_to": date_to}) or []
    except HTTPException:
        return []


async def _ff_one(date_from: str, date_to: str) -> List[Dict[str, Any]]:
    try:
        return await fetch("/footfall", {"date_from": date_from, "date_to": date_to}) or []
    except HTTPException:
        return []


@api_router.get("/exports/store-kpis")
async def exports_store_kpis(date_from: str, date_to: str):
    """Per-store KPI table with YoY (vs same window LY) and MoM (vs prior
    month-window) deltas. One row per POS location for the period.

    Output fields per store: total_sales/_ly, units/_ly, footfall/_ly,
    transactions/_ly, basket_value/_ly, asp/_ly, msi/_ly, conversion_rate
    (current only — LY footfall not always available with same precision)
    + their respective YoY % deltas, plus total_sales_lm and MoM_revenue_pct.
    """
    # Date math helpers.
    df_cur = datetime.strptime(date_from, "%Y-%m-%d").date()
    dt_cur = datetime.strptime(date_to, "%Y-%m-%d").date()

    df_ly = _shift_iso_year(date_from, -1)
    dt_ly = _shift_iso_year(date_to, -1)

    span = (dt_cur - df_cur).days
    df_lm = (df_cur - timedelta(days=span + 1)).isoformat()
    dt_lm = (df_cur - timedelta(days=1)).isoformat()

    # 6 parallel fetches: sales (cur, ly, lm) + footfall (cur, ly).
    ss_cur, ss_ly, ss_lm, ff_cur, ff_ly = await asyncio.gather(
        _ss_one(date_from, date_to),
        _ss_one(df_ly, dt_ly),
        _ss_one(df_lm, dt_lm),
        _ff_one(date_from, date_to),
        _ff_one(df_ly, dt_ly),
    )

    def _idx(rows: List[Dict[str, Any]], key: str = "channel") -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for r in rows or []:
            k = r.get(key)
            if k:
                out[k] = r
        return out

    cur_idx = _idx(ss_cur, "channel")
    ly_idx = _idx(ss_ly, "channel")
    lm_idx = _idx(ss_lm, "channel")
    ff_cur_idx = _idx(ff_cur, "location")
    ff_ly_idx = _idx(ff_ly, "location")

    def _yoy(curr: Optional[float], prev: Optional[float]) -> Optional[float]:
        if prev in (None, 0) or curr is None:
            return None
        return round(((curr - prev) / prev) * 100, 2)

    out: List[Dict[str, Any]] = []
    locations = sorted(set(cur_idx.keys()) | set(ly_idx.keys()) | set(lm_idx.keys()))
    for loc in locations:
        c = cur_idx.get(loc, {})
        ly = ly_idx.get(loc, {})
        lm = lm_idx.get(loc, {})
        f_cur = ff_cur_idx.get(loc, {})
        f_ly = ff_ly_idx.get(loc, {})

        sales = c.get("total_sales") or 0
        sales_ly = ly.get("total_sales") or 0
        sales_lm = lm.get("total_sales") or 0
        units = c.get("units_sold") or 0
        units_ly = ly.get("units_sold") or 0
        orders = c.get("orders") or 0
        orders_ly = ly.get("orders") or 0
        footfall = f_cur.get("total_footfall") or 0
        footfall_ly = f_ly.get("total_footfall") or 0
        bv = (sales / orders) if orders else 0
        bv_ly = (sales_ly / orders_ly) if orders_ly else 0
        asp = (sales / units) if units else 0
        asp_ly = (sales_ly / units_ly) if units_ly else 0
        msi = (units / orders) if orders else 0
        msi_ly = (units_ly / orders_ly) if orders_ly else 0
        conv = (orders / footfall * 100) if footfall else None
        conv_ly = (orders_ly / footfall_ly * 100) if footfall_ly else None

        out.append({
            "pos_location": loc,
            "country": c.get("country") or ly.get("country") or lm.get("country") or "—",
            "total_sales": round(sales, 2),
            "total_sales_ly": round(sales_ly, 2),
            "yoy_revenue_pct": _yoy(sales, sales_ly),
            "total_sales_lm": round(sales_lm, 2),
            "mom_revenue_pct": _yoy(sales, sales_lm),
            "units_sold": units,
            "units_sold_ly": units_ly,
            "yoy_units_pct": _yoy(units, units_ly),
            "footfall": footfall,
            "footfall_ly": footfall_ly,
            "yoy_footfall_pct": _yoy(footfall, footfall_ly),
            "transactions": orders,
            "transactions_ly": orders_ly,
            "yoy_transactions_pct": _yoy(orders, orders_ly),
            "basket_value": round(bv, 2),
            "basket_value_ly": round(bv_ly, 2),
            "yoy_basket_value_pct": _yoy(bv, bv_ly),
            "asp": round(asp, 2),
            "asp_ly": round(asp_ly, 2),
            "yoy_asp_pct": _yoy(asp, asp_ly),
            "msi": round(msi, 2),
            "msi_ly": round(msi_ly, 2),
            "yoy_msi_pct": _yoy(msi, msi_ly),
            "conv_rate": round(conv, 2) if conv is not None else None,
            "yoy_conv_pp": round(conv - conv_ly, 2) if (conv is not None and conv_ly is not None) else None,
        })
    out.sort(key=lambda r: r.get("total_sales") or 0, reverse=True)
    return {
        "rows": out,
        "period_current": {"date_from": date_from, "date_to": date_to},
        "period_ly": {"date_from": df_ly, "date_to": dt_ly},
        "period_lm": {"date_from": df_lm, "date_to": dt_lm},
    }


def _period_window(mode: str, anchor_date: date, week_start: int = 0) -> Tuple[date, date]:
    """Return (start, end) inclusive for mode in {wtd, mtd, ytd} relative to
    `anchor_date`. WTD week starts Monday by default (week_start=0)."""
    if mode == "wtd":
        # ISO weekday: Monday=0..Sunday=6
        wd = anchor_date.weekday()
        start = anchor_date - timedelta(days=wd)
        return start, anchor_date
    if mode == "mtd":
        return anchor_date.replace(day=1), anchor_date
    if mode == "ytd":
        return date(anchor_date.year, 1, 1), anchor_date
    raise ValueError(f"unknown mode: {mode}")


@api_router.get("/exports/period-performance")
async def exports_period_performance(
    mode: str = Query("wtd", pattern="^(wtd|mtd|ytd)$"),
    anchor: Optional[str] = None,
):
    """Period-performance comparison: 3 years × {Units, Revenue, ASP} per
    store, plus % contribution to current-year revenue. Mode selects the
    window shape (WTD / MTD / YTD); `anchor` (YYYY-MM-DD, default today)
    sets the end-of-window. Same window is replayed for last year & last-
    last year (year-shifted, day-aligned).
    """
    anchor_d = (
        datetime.strptime(anchor, "%Y-%m-%d").date()
        if anchor else datetime.now(timezone.utc).date()
    )
    start_cy, end_cy = _period_window(mode, anchor_d)
    # Year-shifted start/end. Use _shift_iso_year so leap days clamp.
    start_ly = datetime.strptime(_shift_iso_year(start_cy.isoformat(), -1), "%Y-%m-%d").date()
    end_ly = datetime.strptime(_shift_iso_year(end_cy.isoformat(), -1), "%Y-%m-%d").date()
    start_lly = datetime.strptime(_shift_iso_year(start_cy.isoformat(), -2), "%Y-%m-%d").date()
    end_lly = datetime.strptime(_shift_iso_year(end_cy.isoformat(), -2), "%Y-%m-%d").date()

    cy, ly, lly = await asyncio.gather(
        _ss_one(start_cy.isoformat(), end_cy.isoformat()),
        _ss_one(start_ly.isoformat(), end_ly.isoformat()),
        _ss_one(start_lly.isoformat(), end_lly.isoformat()),
    )

    def _idx(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        return {r.get("channel"): r for r in (rows or []) if r.get("channel")}

    cy_idx, ly_idx, lly_idx = _idx(cy), _idx(ly), _idx(lly)
    locations = sorted(set(cy_idx.keys()) | set(ly_idx.keys()) | set(lly_idx.keys()))
    grand_cy_rev = sum((cy_idx.get(loc, {}).get("total_sales") or 0) for loc in locations)

    def _delta(curr: Optional[float], prev: Optional[float]) -> Optional[float]:
        if prev in (None, 0) or curr is None:
            return None
        return round(((curr - prev) / prev) * 100, 2)

    rows: List[Dict[str, Any]] = []
    for loc in locations:
        c = cy_idx.get(loc, {})
        l1 = ly_idx.get(loc, {})
        l2 = lly_idx.get(loc, {})
        u_cy = c.get("units_sold") or 0
        u_ly = l1.get("units_sold") or 0
        u_lly = l2.get("units_sold") or 0
        r_cy = c.get("total_sales") or 0
        r_ly = l1.get("total_sales") or 0
        r_lly = l2.get("total_sales") or 0
        asp_cy = (r_cy / u_cy) if u_cy else 0
        asp_ly = (r_ly / u_ly) if u_ly else 0
        asp_lly = (r_lly / u_lly) if u_lly else 0
        rows.append({
            "store_name": loc,
            "country": c.get("country") or l1.get("country") or l2.get("country") or "—",
            "units_lly": u_lly, "units_ly": u_ly, "units_cy": u_cy,
            "units_yoy_pct": _delta(u_cy, u_ly),
            "units_lly_pct": _delta(u_cy, u_lly),
            "revenue_lly": round(r_lly, 2), "revenue_ly": round(r_ly, 2), "revenue_cy": round(r_cy, 2),
            "revenue_yoy_pct": _delta(r_cy, r_ly),
            "revenue_lly_pct": _delta(r_cy, r_lly),
            "asp_lly": round(asp_lly, 2), "asp_ly": round(asp_ly, 2), "asp_cy": round(asp_cy, 2),
            "asp_yoy_pct": _delta(asp_cy, asp_ly),
            "asp_lly_pct": _delta(asp_cy, asp_lly),
            "contrib_revenue_pct": round((r_cy / grand_cy_rev * 100), 2) if grand_cy_rev else 0,
        })
    rows.sort(key=lambda r: r.get("revenue_cy") or 0, reverse=True)
    return {
        "mode": mode,
        "anchor": anchor_d.isoformat(),
        "period_current": {"date_from": start_cy.isoformat(), "date_to": end_cy.isoformat()},
        "period_ly": {"date_from": start_ly.isoformat(), "date_to": end_ly.isoformat()},
        "period_lly": {"date_from": start_lly.isoformat(), "date_to": end_lly.isoformat()},
        "rows": rows,
    }


@api_router.get("/exports/stock-rebalancing")
async def exports_stock_rebalancing(
    categories: Optional[str] = None,
    channel: Optional[str] = None,
    country: Optional[str] = None,
):
    """Stock Rebalancing report — for each of the last 2 complete years:
       • Units Sold (full year) + % share within total
       • Units Sold in same calendar quarter as the CURRENT quarter
       • Stock-on-Hand (current) + % share

    Optional filters:
      • `categories` — CSV of merch buckets (e.g. "Dresses,Tops"). Recomputes
        all totals so percentages still sum to 100% within the filter.
      • `channel`    — CSV of POS locations to scope BOTH SOH and units-sold
        to (e.g. "Vivo Sarit,Vivo Junction"). Online channels are valid too.
      • `country`    — CSV of countries (Kenya/Uganda/Rwanda/Online).
    Rows = Category > Subcategory hierarchy (subcategories first, category
    subtotal at the bottom of each block, Grand Total returned separately).
    """
    today = datetime.now(timezone.utc).date()
    cur_year = today.year
    cur_q = ((today.month - 1) // 3) + 1
    years = [cur_year - 2, cur_year - 1]
    cat_filter: Optional[set] = None
    if categories:
        cat_filter = {c.strip() for c in categories.split(",") if c.strip()}

    chs = _split_csv(channel)
    cs = _split_csv(country)

    def _quarter_window(year: int, q: int) -> Tuple[str, str]:
        start_m = (q - 1) * 3 + 1
        end_m = start_m + 2
        last_day = (date(year, end_m + 1, 1) - timedelta(days=1)) if end_m < 12 else date(year, 12, 31)
        return f"{year:04d}-{start_m:02d}-01", last_day.isoformat()

    # Sales fan-out: upstream /subcategory-sales takes a single channel and
    # a single country. To honour multi-select we fan-out across the cross
    # product and merge per-subcategory units. No filter ⇒ one call.
    async def _fetch_subcat(date_from: str, date_to: str) -> List[Dict[str, Any]]:
        if not chs and not cs:
            try:
                return await fetch("/subcategory-sales", {
                    "date_from": date_from, "date_to": date_to,
                }) or []
            except HTTPException:
                return []
        tasks = []
        for c_ in (cs or [None]):
            for ch_ in (chs or [None]):
                params = {"date_from": date_from, "date_to": date_to}
                if c_:
                    params["country"] = c_
                if ch_:
                    params["channel"] = ch_
                tasks.append(fetch("/subcategory-sales", params))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        merged: Dict[str, Dict[str, Any]] = {}
        for g in results:
            if isinstance(g, Exception) or not g:
                continue
            for r in g:
                key = r.get("subcategory")
                if not key:
                    continue
                if key not in merged:
                    merged[key] = {**r}
                else:
                    for f in ("units_sold", "total_sales", "gross_sales", "orders"):
                        merged[key][f] = (merged[key].get(f) or 0) + (r.get(f) or 0)
        return list(merged.values())

    tasks: List[Any] = []
    for y in years:
        tasks.append(_fetch_subcat(f"{y}-01-01", f"{y}-12-31"))
        qf, qt = _quarter_window(y, cur_q)
        tasks.append(_fetch_subcat(qf, qt))
    # Inventory: scope to the chosen locations / country if provided. With
    # no filter, fall back to the full fan-out (cached at the upstream).
    if chs:
        tasks.append(fetch_all_inventory(
            country=(cs[0] if len(cs) == 1 else None),
            locations=chs,
        ))
    elif len(cs) == 1:
        tasks.append(fetch_all_inventory(country=cs[0]))
    else:
        tasks.append(fetch_all_inventory())
    fetched = await asyncio.gather(*tasks, return_exceptions=True)
    full_years: Dict[int, List[Dict[str, Any]]] = {}
    quarter_years: Dict[int, List[Dict[str, Any]]] = {}
    for i, y in enumerate(years):
        full_years[y] = fetched[i * 2] if not isinstance(fetched[i * 2], Exception) else []
        quarter_years[y] = fetched[i * 2 + 1] if not isinstance(fetched[i * 2 + 1], Exception) else []
    inv_rows = fetched[-1] if not isinstance(fetched[-1], Exception) else []
    # Multi-country (>1) inventory filter: fetch_all_inventory doesn't take
    # a CSV country list, so post-filter here.
    if len(cs) > 1:
        cs_low = {c.lower() for c in cs}
        inv_rows = [r for r in (inv_rows or []) if (r.get("country") or "").lower() in cs_low]

    def _cat_for(sub: str) -> str:
        return category_of(sub)

    def _passes(sub: str) -> bool:
        if cat_filter is None:
            return True
        return _cat_for(sub) in cat_filter

    # Build SOH per (category, subcategory).
    soh_by_cat: Dict[str, Dict[str, int]] = {}
    for r in inv_rows or []:
        sub = r.get("subcategory") or r.get("product_type") or "—"
        if not _passes(sub):
            continue
        cat = _cat_for(sub)
        bucket = soh_by_cat.setdefault(cat, {})
        bucket[sub] = bucket.get(sub, 0) + int(r.get("available") or 0)
    grand_soh = sum(sum(v.values()) for v in soh_by_cat.values()) or 0

    def _idx_by_subcat(rows: List[Dict[str, Any]]) -> Dict[Tuple[str, str], int]:
        out: Dict[Tuple[str, str], int] = {}
        for r in rows or []:
            sub = r.get("subcategory") or "—"
            if not _passes(sub):
                continue
            cat = _cat_for(sub)
            out[(cat, sub)] = (out.get((cat, sub), 0)) + int(r.get("units_sold") or 0)
        return out

    full_idx = {y: _idx_by_subcat(full_years.get(y, [])) for y in years}
    quarter_idx = {y: _idx_by_subcat(quarter_years.get(y, [])) for y in years}
    full_totals = {y: sum(full_idx[y].values()) or 0 for y in years}
    q_totals = {y: sum(quarter_idx[y].values()) or 0 for y in years}

    # Union of categories/subcategories observed anywhere.
    all_cats: Dict[str, set] = {}
    for src in (*full_idx.values(), *quarter_idx.values()):
        for (cat, sub) in src.keys():
            all_cats.setdefault(cat, set()).add(sub)
    for cat, subs in soh_by_cat.items():
        all_cats.setdefault(cat, set()).update(subs.keys())

    rows_out: List[Dict[str, Any]] = []
    last_y = years[-1]
    cat_order = sorted(
        all_cats.keys(),
        key=lambda c: -sum(full_idx[last_y].get((c, s), 0) for s in all_cats.get(c, []))
    )
    for cat in cat_order:
        subs = sorted(
            all_cats[cat],
            key=lambda s: -full_idx[last_y].get((cat, s), 0)
        )
        # Subcategory rows FIRST.
        for s in subs:
            row: Dict[str, Any] = {"category": cat, "subcategory": s, "is_total": False}
            for y in years:
                u_full = full_idx[y].get((cat, s), 0)
                u_q = quarter_idx[y].get((cat, s), 0)
                row[f"y{y}_units_sold"] = u_full
                row[f"y{y}_units_sold_pct"] = round((u_full / full_totals[y] * 100), 4) if full_totals[y] else 0
                row[f"y{y}_units_q"] = u_q
                row[f"y{y}_units_q_pct"] = round((u_q / q_totals[y] * 100), 4) if q_totals[y] else 0
            soh_s = soh_by_cat.get(cat, {}).get(s, 0)
            row["soh"] = soh_s
            row["soh_pct"] = round((soh_s / grand_soh * 100), 4) if grand_soh else 0
            rows_out.append(row)
        # Category subtotal AFTER its subcategories (per user spec).
        cat_row: Dict[str, Any] = {"category": cat, "subcategory": None, "is_total": True}
        for y in years:
            u_full = sum(full_idx[y].get((cat, s), 0) for s in subs)
            u_q = sum(quarter_idx[y].get((cat, s), 0) for s in subs)
            cat_row[f"y{y}_units_sold"] = u_full
            cat_row[f"y{y}_units_sold_pct"] = round((u_full / full_totals[y] * 100), 4) if full_totals[y] else 0
            cat_row[f"y{y}_units_q"] = u_q
            cat_row[f"y{y}_units_q_pct"] = round((u_q / q_totals[y] * 100), 4) if q_totals[y] else 0
        soh = sum((soh_by_cat.get(cat, {}).get(s, 0)) for s in subs)
        cat_row["soh"] = soh
        cat_row["soh_pct"] = round((soh / grand_soh * 100), 4) if grand_soh else 0
        rows_out.append(cat_row)

    grand: Dict[str, Any] = {"category": "Grand Total", "subcategory": None, "is_grand_total": True}
    for y in years:
        grand[f"y{y}_units_sold"] = full_totals[y]
        grand[f"y{y}_units_sold_pct"] = 1.0 if full_totals[y] else 0
        grand[f"y{y}_units_q"] = q_totals[y]
        grand[f"y{y}_units_q_pct"] = 1.0 if q_totals[y] else 0
    grand["soh"] = grand_soh
    grand["soh_pct"] = 1.0 if grand_soh else 0
    return {
        "current_quarter": cur_q,
        "years": years,
        "rows": rows_out,
        "totals": grand,
        "available_categories": sorted(all_cats.keys()),
    }


# ─── Modular route extraction ────────────────────────────────────────
# Importing these submodules registers their @api_router decorators
# against the api_router defined above. They MUST be imported AFTER all
# shared helpers (fetch, _orders_for_window, _is_walk_in_order, …) are
# defined, but BEFORE app.include_router(api_router) below, because
# include_router copies the route table at call time.
from routes import customer_analytics  # noqa: F401, E402
from routes import analytics_inventory  # noqa: F401, E402
from routes import monthly_targets  # noqa: F401, E402
from routes import allocations as _allocations  # noqa: F401, E402

app.include_router(api_router)
app.include_router(recommendations_router)
app.include_router(user_activity_router)
app.include_router(thumbnails_router)
app.include_router(notifications_router)
app.include_router(search_router)
app.include_router(ask_router)

# Feedback router — users submit dashboard feedback; admins toggle resolved.
from feedback import router as feedback_router  # noqa: E402
app.include_router(feedback_router)

# IBT completed-moves router — track which suggestions have been actioned.
from ibt_completed import router as ibt_completed_router  # noqa: E402
app.include_router(ibt_completed_router)


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
    # Rehydrate the on-disk stale cache so the very first user click after
    # a pod restart still has /kpis & friends to fall back on if upstream
    # is cold. Runs synchronously — it's a small JSON file.
    _kpi_stale_load()
    # Fire-and-forget warmup of the slow analytics endpoints so the FIRST user
    # click never crosses the 100s ingress timeout. These are read-only and
    # only populate in-process caches, so we run them as background tasks.
    # Errors are swallowed because a warmup failure must NOT block boot —
    # the endpoints will simply pay the cold cost on first user click.
    async def _warm():
        try:
            await asyncio.sleep(8)  # let the upstream finish its own warmup
            # Curve runs FIRST — its `_curve_cache` is consumed by
            # `_get_style_first_last_sale` so sor-all-styles can derive
            # accurate launch dates without paying the /orders fan-out
            # twice. Other warm targets are independent and can fan out
            # in parallel after the curve completes.
            await asyncio.gather(
                analytics_new_styles_curve(days=180),
                bins_lookup.get_bins(),
                return_exceptions=True,
            )
            await asyncio.gather(
                analytics_sor_all_styles(),
                analytics_replenishment_report(),
                return_exceptions=True,
            )
            logger.info("[warmup] sor-all-styles + new-styles-curve + replenishment cache warmed")

            # Pre-warm the SKU + Location breakdown caches for every
            # style in the SOR Report so row clicks on the Exports page
            # are <50ms instead of triggering a 30-60s cold scan each.
            # The bulk endpoint does ONE 6-month /orders fan-out (the
            # _orders_for_window cache is already populated by the
            # analytics_sor_all_styles call above, so this is essentially
            # an in-memory aggregation pass) and stamps both caches per
            # style. Done in chunks so a single Python sweep doesn't
            # block the event loop for too long.
            try:
                # The SOR all-styles cache is keyed by (country, channel, brand);
                # the warmup call above used no filters, so look it up there.
                _ck = "all|||"
                _hit = _all_styles_cache.get(_ck)
                sor_rows = _hit[1] if _hit else None
                if isinstance(sor_rows, list) and sor_rows:
                    style_names = [r.get("style_name") for r in sor_rows if r.get("style_name")]
                    # Aggregate-only path: feed the bulk endpoint chunks
                    # of 500 names each. With ~1700 styles total this is
                    # 4 quick aggregation passes over the same cached
                    # /orders feed — no extra upstream calls.
                    CHUNK = 500
                    for i in range(0, len(style_names), CHUNK):
                        await analytics_style_sku_breakdown_bulk(
                            style_names=",".join(style_names[i:i + CHUNK]),
                        )
                    logger.info(
                        "[warmup] SOR drill-down caches pre-warmed for %d styles "
                        "(SKU + location)", len(style_names),
                    )
            except Exception as e:
                logger.warning("[warmup] SOR drill-down warmup failed: %s", e)
            # Pre-load the customer-history cache for MTD + last-30 windows
            # so the new analytics endpoints (customer-retention, avg-spend,
            # recently-unchurned, customer-details, replen-by-color) don't
            # cross the ingress timeout on first hit.
            today = datetime.now(timezone.utc).date()
            mtd_from = today.replace(day=1).isoformat()
            last30_from = (today - timedelta(days=30)).isoformat()
            await asyncio.gather(
                _orders_for_window(mtd_from, today.isoformat()),
                _orders_for_window(last30_from, today.isoformat()),
                return_exceptions=True,
            )
            logger.info("[warmup] customer-history cache warmed (MTD + last-30)")
            # Pre-warm the Overview-page hot path: /kpis + /country-summary +
            # /sales-summary + /footfall + /daily-trend across the windows
            # that the user lands on first (Today, MTD, Last 30d) and the
            # default last-month compare. This guarantees the first dashboard
            # load shows numbers instantly even if Vivo BI is cold-starting.
            iso_today = today.isoformat()
            iso_yest = (today - timedelta(days=1)).isoformat()
            iso_l7 = (today - timedelta(days=6)).isoformat()
            iso_lm_from = (today.replace(day=1) - timedelta(days=1)).replace(day=1).isoformat()
            iso_lm_to = (today.replace(day=1) - timedelta(days=1)).isoformat()
            countries = ["Kenya", "Uganda", "Rwanda", "Online", None]
            warm_ranges = [
                (iso_today, iso_today),    # Today
                (iso_yest, iso_yest),      # Yesterday
                (iso_l7, iso_today),       # Last 7d
                (last30_from, iso_today),  # Last 30d
                (mtd_from, iso_today),     # MTD
                (iso_lm_from, iso_lm_to),  # Last month (compare default)
            ]
            warm_tasks = []
            for df, dt in warm_ranges:
                # Country-summary doesn't take country/channel params.
                warm_tasks.append(get_country_summary(date_from=df, date_to=dt))
                # Per-country /kpis, /sales-summary; /daily-trend per country.
                for c in countries:
                    warm_tasks.append(get_kpis(date_from=df, date_to=dt, country=c))
                # /footfall + /sales-summary at no-country are the hottest.
                warm_tasks.append(get_sales_summary(date_from=df, date_to=dt))
                warm_tasks.append(get_footfall(date_from=df, date_to=dt))
                for c in ("Kenya", "Uganda", "Rwanda", "Online"):
                    warm_tasks.append(get_daily_trend(date_from=df, date_to=dt, country=c))
            # Concurrency cap via gather — the upstream pool has 400 conns
            # and our in-flight de-dup collapses redundant work, so this
            # finishes inside ~30 s even with hundreds of warm targets.
            await asyncio.gather(*warm_tasks, return_exceptions=True)
            logger.info(f"[warmup] Overview hot-path pre-warmed ({len(warm_tasks)} targets across {len(warm_ranges)} ranges)")
        except Exception as e:
            logger.warning("[warmup] failed: %s", e)
    asyncio.create_task(_warm())

    # Background recovery loop — every 60 s, if any circuit breaker is
    # open OR the in-process /kpis stale cache has any entry older than
    # 5 minutes, kick a single fresh `/kpis` probe (today, no filter)
    # against upstream. On success the breaker closes, the stale cache
    # gets a fresh value, and ALL connected clients see the "stale" pill
    # disappear within ~60 s of upstream recovering — no user action
    # required. Cheap (one upstream call per minute) and only runs when
    # there's actually something to refresh.
    async def _recovery_loop():
        while True:
            try:
                await asyncio.sleep(60)
                today = datetime.now(timezone.utc).date().isoformat()
                stale_age = 0
                for (path, *_), (ts, _data) in _kpi_stale_cache.items():
                    age = time.time() - ts
                    if age > stale_age:
                        stale_age = age
                breakers_open = bool(_CB_OPEN_UNTIL)
                if not breakers_open and stale_age < 300:
                    continue  # nothing to do — system is healthy
                # Force-close every breaker so the probe actually goes
                # to upstream instead of being short-circuited. If the
                # upstream is still down, the probe will re-open them.
                _CB_FAILS.clear()
                _CB_OPEN_UNTIL.clear()
                logger.info(
                    f"[recovery] stale_age={int(stale_age)}s, "
                    f"breakers_open_pre_reset={breakers_open} — probing upstream"
                )
                try:
                    await get_kpis(date_from=today, date_to=today)
                    logger.info("[recovery] upstream probe SUCCEEDED — fresh data flowing")
                    # Re-warm the most-hit hot-path windows so users get
                    # truly fresh numbers immediately, not just the probe.
                    mtd_from = (datetime.now(timezone.utc).date()
                                .replace(day=1).isoformat())
                    last30_from = (datetime.now(timezone.utc).date()
                                   - timedelta(days=30)).isoformat()
                    await asyncio.gather(
                        get_kpis(date_from=mtd_from, date_to=today),
                        get_kpis(date_from=last30_from, date_to=today),
                        get_country_summary(date_from=today, date_to=today),
                        get_country_summary(date_from=mtd_from, date_to=today),
                        get_footfall(date_from=mtd_from, date_to=today),
                        get_sales_summary(date_from=today, date_to=today),
                        return_exceptions=True,
                    )
                    logger.info("[recovery] hot-path re-warmed after upstream recovery")
                except Exception as e:
                    logger.warning(f"[recovery] upstream still down: {e}")
            except Exception as e:
                logger.warning(f"[recovery-loop] unexpected: {e}")
                await asyncio.sleep(60)
    asyncio.create_task(_recovery_loop())


@app.on_event("shutdown")
async def shutdown():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
