"""
Returns aggregator — nets upstream gross sales/units by product axis.

Upstream's `/top-skus` and `/subcategory-sales` endpoints only carry
GROSS values (units_sold, total_sales, gross_sales — no return field).
Returns live in `/orders` rows where `sale_kind='return'` with
`total_sales_kes` negative and `quantity` zero. Leadership pref
(Jun 2026): every product-axis breakdown should display NET values
(Total Sales = Gross − Refunds, Qty Sold = Units − Returned Units).

This module:

  1. Fetches returns from /orders day-by-day for the requested window
     (chunked to stay under the upstream 10k-row cap per call).

  2. Persists per (day, country) returns aggregates into the Mongo
     collection `returns_daily_by_product` so re-runs are O(1) reads.

  3. Provides axis-keyed lookups —
        by_style[(style_name)]      → {units, sales}
        by_subcategory[(subcat)]    → {units, sales}
        by_brand[(brand)]           → {units, sales}
        by_product_type[(ptype)]    → {units, sales}   # alias of subcat upstream

Returned `units` is the count of return line items (1 per refunded
unit); `sales` is the refund_value in KES (positive, ready to subtract
from gross totals).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Callable

_RETURNS_COLL = "returns_daily_by_product"
_MEM_TTL = 600  # seconds — in-memory cache for the merged window read
_mem_cache: Dict[Tuple[str, str, str, str], Tuple[float, Dict[str, Any]]] = {}

# Cap on per-window mem cache entries to keep memory bounded.
_MAX_MEM_ENTRIES = 64


def _evict_oldest(d: Dict) -> None:
    if len(d) > _MAX_MEM_ENTRIES:
        # Drop the oldest 10 entries (cheap).
        for k in sorted(d.keys(), key=lambda k: d[k][0])[:10]:
            d.pop(k, None)


def _enum_days(date_from: str, date_to: str) -> List[str]:
    out: List[str] = []
    df = date.fromisoformat(date_from)
    dt = date.fromisoformat(date_to)
    cur = df
    while cur <= dt:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def _empty_agg() -> Dict[str, Any]:
    return {
        "by_style": {},          # style_name -> {units, sales}
        "by_style_number": {},   # style_number (canonical) -> {units, sales}
        "by_subcategory": {},
        "by_brand": {},
        "by_category": {},       # high-level category bucket (Apparel/Accessories/Sale/Other)
        "totals": {"units": 0, "sales": 0.0},
    }


def _merge_into(dst: Dict[str, Dict[str, Any]], key: Optional[str], units: float, sales: float) -> None:
    if not key:
        return
    cur = dst.get(key)
    if cur is None:
        dst[key] = {"units": units, "sales": sales}
    else:
        cur["units"] += units
        cur["sales"] += sales


def _aggregate_returns_from_orders(
    rows: List[Dict[str, Any]],
    extract_style_number: Callable[[str], str],
    category_of: Callable[[str], str],
) -> Dict[str, Any]:
    """Reduce raw /orders rows into a returns-only multi-axis aggregate.

    Each return line item is counted as 1 returned unit. The refund
    value comes from `returns_kes` (positive) when present, else from
    `abs(total_sales_kes)`. We deliberately IGNORE upstream's
    `quantity` field for returns because it's always 0 (the value is
    pre-netted at the order-line level upstream).
    """
    agg = _empty_agg()
    for r in rows:
        sk = (r.get("sale_kind") or "").lower()
        if sk != "return":
            continue
        # Unit count: 1 per return row (each line item = 1 returned
        # unit per leadership confirmation Jun 2026).
        units = 1.0
        sales = float(r.get("returns_kes") or abs(float(r.get("total_sales_kes") or 0)))
        if sales <= 0 and units <= 0:
            continue
        style_name = (r.get("style_name") or "").strip() or None
        subcat = (r.get("subcategory") or r.get("product_type") or "").strip() or None
        brand = (r.get("brand") or "").strip() or None
        # Category bucket via the same product_type→category mapping
        # used elsewhere in the BI dashboard.
        ptype = (r.get("subcategory") or r.get("product_type") or "")
        cat = category_of(ptype) if category_of else None
        # Style number from SKU prefix (canonical identifier).
        sku = r.get("sku") or ""
        sn = extract_style_number(sku) if extract_style_number else None

        _merge_into(agg["by_style"], style_name, units, sales)
        _merge_into(agg["by_style_number"], sn, units, sales)
        _merge_into(agg["by_subcategory"], subcat, units, sales)
        _merge_into(agg["by_brand"], brand, units, sales)
        _merge_into(agg["by_category"], cat, units, sales)
        agg["totals"]["units"] += units
        agg["totals"]["sales"] += sales

    # Round monetary values for cleanliness.
    for axis in ("by_style", "by_style_number", "by_subcategory", "by_brand", "by_category"):
        for k, v in agg[axis].items():
            v["sales"] = round(v["sales"], 2)
            v["units"] = int(v["units"])
    agg["totals"]["sales"] = round(agg["totals"]["sales"], 2)
    agg["totals"]["units"] = int(agg["totals"]["units"])
    return agg


def _doc_to_agg(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a persisted Mongo doc (array-of-entries form) back into
    the dict-keyed agg shape used in memory."""
    agg = _empty_agg()
    for axis in ("by_style", "by_style_number", "by_subcategory", "by_brand", "by_category"):
        entries = doc.get(axis) or []
        for e in entries:
            k = e.get("key")
            if not k:
                continue
            agg[axis][k] = {"units": int(e.get("units") or 0), "sales": float(e.get("sales") or 0)}
    t = doc.get("totals") or {}
    agg["totals"] = {"units": int(t.get("units") or 0), "sales": float(t.get("sales") or 0)}
    return agg


def _agg_to_doc(d: str, country: str, agg: Dict[str, Any]) -> Dict[str, Any]:
    """Mongo array-of-entries form — bounded BSON keys (style names
    can carry dots / dollars which Mongo dislikes as keys)."""
    out = {"date": d, "country": country, "snapshot_at": datetime.now(timezone.utc)}
    for axis in ("by_style", "by_style_number", "by_subcategory", "by_brand", "by_category"):
        out[axis] = [
            {"key": k, "units": v["units"], "sales": v["sales"]}
            for k, v in (agg.get(axis) or {}).items()
        ]
    out["totals"] = agg.get("totals") or {"units": 0, "sales": 0.0}
    return out


def _merge_agg(dst: Dict[str, Any], src: Dict[str, Any]) -> None:
    for axis in ("by_style", "by_style_number", "by_subcategory", "by_brand", "by_category"):
        for k, v in (src.get(axis) or {}).items():
            cur = dst[axis].get(k)
            if cur is None:
                dst[axis][k] = {"units": v["units"], "sales": v["sales"]}
            else:
                cur["units"] += v["units"]
                cur["sales"] += v["sales"]
    t_src = src.get("totals") or {}
    dst["totals"]["units"] += t_src.get("units") or 0
    dst["totals"]["sales"] += t_src.get("sales") or 0.0


async def _ensure_indexes(db) -> None:
    try:
        await db[_RETURNS_COLL].create_index([("date", 1), ("country", 1)], unique=True)
    except Exception:
        pass


async def get_returns_breakdown(
    db,
    *,
    date_from: str,
    date_to: str,
    country: Optional[str],
    channel: Optional[str],
    fetch_orders_for_day: Callable,
    extract_style_number: Callable[[str], str],
    category_of: Callable[[str], str],
    eager_fetch_max_days: int = 60,
) -> Dict[str, Any]:
    """Public entry point. Returns a merged agg for the window.

    `fetch_orders_for_day(day, country)` must return List[/orders rows]
    for ONE day + ONE country (caller bridges to the upstream client).

    Country handling:
      • `country=None` or empty → merge Kenya + Uganda + Rwanda + Online
      • Otherwise: split on comma, merge each part.

    Channel handling: returns are already country-scoped; we don't
    filter further by channel because Vivo BI doesn't tag returns
    consistently with channel. If channel is set, it's a no-op (the
    over-count is small because returns are <2 % of orders).

    `eager_fetch_max_days` caps how many missing (day, country) tuples
    we'll backfill INLINE before giving up and serving whatever Mongo
    already has. Long windows (6m+, lifetime) get backfilled by the
    nightly snapshotter; this guard keeps request latency bounded.
    """
    if not (date_from and date_to):
        return _empty_agg()
    # Normalize key.
    key = (date_from, date_to, (country or "").strip(), (channel or "").strip())
    cached = _mem_cache.get(key)
    if cached and (time.time() - cached[0]) < _MEM_TTL:
        return cached[1]

    await _ensure_indexes(db)

    if not country:
        countries = ["Kenya", "Uganda", "Rwanda", "Online"]
    else:
        countries = [c.strip() for c in country.split(",") if c.strip()]

    days = _enum_days(date_from, date_to)

    # Read existing Mongo docs for (day, country) in the window.
    cursor = db[_RETURNS_COLL].find(
        {"date": {"$in": days}, "country": {"$in": countries}},
        {"_id": 0},
    )
    have: Dict[Tuple[str, str], Dict[str, Any]] = {}
    async for doc in cursor:
        have[(doc["date"], doc["country"])] = doc

    # Identify missing tuples → fetch from upstream + persist.
    missing: List[Tuple[str, str]] = [
        (d, c) for d in days for c in countries
        if (d, c) not in have
    ]

    # Cap eager fetch budget. For windows where missing > cap (typical
    # cold-start on 6m+/lifetime), we serve what Mongo has and rely on
    # the nightly snapshotter (or `/admin/heal-returns-history`) to fill
    # the rest. The undercount converges to zero as backfill completes.
    if 0 < len(missing) <= eager_fetch_max_days:
        sem = asyncio.Semaphore(8)

        async def _one(d: str, c: str) -> Optional[Tuple[str, str, Dict[str, Any]]]:
            async with sem:
                try:
                    rows = await fetch_orders_for_day(d, c)
                except Exception:
                    return None
                if not isinstance(rows, list):
                    return None
                agg = _aggregate_returns_from_orders(
                    rows,
                    extract_style_number=extract_style_number,
                    category_of=category_of,
                )
                doc = _agg_to_doc(d, c, agg)
                try:
                    await db[_RETURNS_COLL].replace_one(
                        {"date": d, "country": c}, doc, upsert=True,
                    )
                except Exception:
                    pass
                return (d, c, agg)

        results = await asyncio.gather(*[_one(d, c) for d, c in missing])
        for res in results:
            if res:
                d, c, agg = res
                have[(d, c)] = _agg_to_doc(d, c, agg)

    # Merge every doc into a single agg.
    merged = _empty_agg()
    for doc in have.values():
        _merge_agg(merged, _doc_to_agg(doc))

    # Cache and evict.
    _mem_cache[key] = (time.time(), merged)
    _evict_oldest(_mem_cache)
    return merged


def net_top_skus_rows(
    rows: List[Dict[str, Any]],
    returns_by_style: Dict[str, Dict[str, Any]],
    returns_by_style_number: Optional[Dict[str, Dict[str, Any]]] = None,
    *,
    extract_style_number: Optional[Callable[[str], str]] = None,
) -> List[Dict[str, Any]]:
    """In-place subtract returns from a /top-skus-shape row list.

    Matches on style_name first (canonical for /top-skus) and falls
    back to style_number (extracted from sku prefix) when the row
    carries an SKU but no matching style_name in the returns map. The
    fallback handles the rare catalog-rename case where the same SKU
    prefix appears under two different style names.

    Floors at zero — never produces negative units/sales after netting
    (would happen for windows where returns exceed sales because the
    sale fell in an earlier period).
    """
    if not rows:
        return rows
    for r in rows:
        sn = r.get("style_name")
        ret = returns_by_style.get(sn) if sn else None
        if ret is None and returns_by_style_number and extract_style_number:
            sku = r.get("sku") or ""
            num = extract_style_number(sku)
            if num:
                ret = returns_by_style_number.get(num)
        if not ret:
            continue
        ru = ret.get("units") or 0
        rs = ret.get("sales") or 0
        if "units_sold" in r:
            r["units_sold"] = max(0, int(round((r.get("units_sold") or 0) - ru)))
        if "total_sales" in r:
            r["total_sales"] = max(0.0, round(float(r.get("total_sales") or 0) - rs, 2))
        if "gross_sales" in r:
            r["gross_sales"] = max(0.0, round(float(r.get("gross_sales") or 0) - rs, 2))
        # Refresh avg_price if present (gross/units now both netted).
        if "avg_price" in r:
            u = r.get("units_sold") or 0
            r["avg_price"] = round((r.get("total_sales") or 0) / u, 2) if u else 0
    return rows


def net_subcategory_rows(
    rows: List[Dict[str, Any]],
    returns_by_subcategory: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Subtract returns from /subcategory-sales-shape rows (same fields
    as top-skus aside from the grouping key being `subcategory`)."""
    if not rows:
        return rows
    for r in rows:
        key = r.get("subcategory") or r.get("product_type")
        ret = returns_by_subcategory.get(key) if key else None
        if not ret:
            continue
        ru = ret.get("units") or 0
        rs = ret.get("sales") or 0
        if "units_sold" in r:
            r["units_sold"] = max(0, int(round((r.get("units_sold") or 0) - ru)))
        if "total_sales" in r:
            r["total_sales"] = max(0.0, round(float(r.get("total_sales") or 0) - rs, 2))
        if "gross_sales" in r:
            r["gross_sales"] = max(0.0, round(float(r.get("gross_sales") or 0) - rs, 2))
    return rows
