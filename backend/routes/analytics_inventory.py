"""Inventory & merchandise analytics endpoints — extracted from server.py
during the 2026-04-30 refactor pass.

Endpoints:
  GET /api/analytics/replenish-by-color
      Replenishment recommendations by color, derived from cached SOR +
      bulk SKU breakdown.
  GET /api/analytics/aged-stock
      Per-SKU aged-stock report — drives markdown / IBT / clearance
      decisions in store ops.

Both endpoints share the ``fetch_all_inventory``, ``_orders_for_window``
and ``is_warehouse_location`` helpers from server.py.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, Query

# Late imports — server.py imports this module AFTER its helpers exist.
from server import (
    api_router,
    _safe_fetch,
    _orders_for_window,
    _split_csv,
    fetch_all_inventory,
    is_warehouse_location,
)
from auth import get_current_user


# ─── /analytics/replenish-by-color ────────────────────────────────────
@api_router.get("/analytics/replenish-by-color")
async def analytics_replenish_by_color(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    min_units_sold: int = Query(20, ge=0),
    min_sor_percent: float = Query(50.0, ge=0, le=100),
    max_weeks_of_cover: float = Query(8.0, ge=0.5, le=52),
    user=Depends(get_current_user),
):
    """Replenishment recommendations by color.

    Filters styles that qualify for replen:
      • Units sold (last 6 months) ≥ `min_units_sold`
      • Sell-out rate ≥ `min_sor_percent`
      • Weeks of cover < `max_weeks_of_cover` (using 3-week sales rate)

    For each qualifying style we break down sales & stock by COLOR. Each
    color gets its own target stock = (color_3w_units / 21) × 56 days
    (i.e. 8 weeks of cover at the recent run-rate). Recommended replen
    qty per color = max(0, target − current SOH).

    Output: list of {style_name, brand, subcategory, total_units_6m,
    total_soh, weeks_of_cover, sor_percent, sell_thru_30d, colors:
    [{color, units_6m, units_3w, soh_total, target_qty, recommended_qty,
    pct_of_style_sales}, …], total_recommended_qty}.
    Sorted by total_recommended_qty descending.

    Source data: re-uses the cached SOR list from /sor (new + repeat
    styles) plus the BULK SKU breakdown so we don't fan out per-style.
    """
    # Pull /sor with an explicit 6-month window. Upstream defaults to a
    # tiny "last few days" window when no dates are passed — Zena's
    # 6-month units_sold=417 / sor=81.8% becomes 33 / 26.2% in the
    # default window, dropping every replen candidate before we even
    # start. Always anchor SOR to a stable 6-month period instead.
    today = datetime.now(timezone.utc).date()
    sor_from = (today - timedelta(days=180)).isoformat()
    sor_to = today.isoformat()
    sor_rows = await _safe_fetch("/sor", {
        "date_from": sor_from, "date_to": sor_to,
        "country": country, "channel": channel, "limit": 5000,
    }) or []

    # Filter to candidates worth replenishing.
    candidates = []
    for r in sor_rows:
        units_6m = int(r.get("units_sold") or 0)
        sor_pct = float(r.get("sor_percent") or r.get("sor") or 0)
        soh = float(r.get("current_stock") or r.get("soh") or 0)
        # 3-week rate proxy from upstream sell-thru (units sold last 30d).
        # Upstream's `weeks_of_cover` already accounts for this; if it's
        # missing we'll compute below from the SKU breakdown.
        woc = r.get("weeks_of_cover")
        if units_6m < min_units_sold:
            continue
        if sor_pct < min_sor_percent:
            continue
        # Skip if we can't compute WoC at all (zero current stock means
        # already stocked-out — those go to `out-of-stock` not replenish).
        if soh <= 0:
            continue
        if woc is not None and float(woc) >= max_weeks_of_cover:
            continue
        candidates.append(r)

    if not candidates:
        return []

    # Cap to top 100 candidates by units_sold; final output is bounded by
    # how many actually need replen so this is a soft cap.
    candidates.sort(key=lambda r: r.get("units_sold") or 0, reverse=True)
    candidates = candidates[:100]
    candidate_names = {r.get("style_name") for r in candidates if r.get("style_name")}

    # Single 30-day /orders fan-out — much cheaper than the 6-month bulk
    # SKU breakdown. We use it to compute per-(style, color) recent sell-
    # through. 30 days is enough for an 8-week-cover replen calc since
    # we still have meaningful daily run-rates without overwhelming upstream.
    look_from = (today - timedelta(days=30)).isoformat()
    sales_rows = await _orders_for_window(look_from, today.isoformat(), country, channel)

    # (style_name, color) → units_30d / sales_30d
    color_30d: Dict[Tuple[str, str], int] = defaultdict(int)
    style_total_30d: Dict[str, int] = defaultdict(int)
    for r in sales_rows:
        sn = (r.get("style_name") or "").strip()
        if sn not in candidate_names:
            continue
        color = (r.get("color_print") or r.get("color") or "—").strip() or "—"
        qty = int(r.get("quantity") or 0)
        color_30d[(sn, color)] += qty
        style_total_30d[sn] += qty

    # Per-(style, color) SOH from the inventory cache.
    inv = await fetch_all_inventory(country=country) or []
    chs_set = set(_split_csv(channel)) if channel else None
    color_soh: Dict[Tuple[str, str], float] = defaultdict(float)
    for r in inv:
        sn = (r.get("style_name") or "").strip()
        if sn not in candidate_names:
            continue
        if chs_set and (r.get("location_name") or "") not in chs_set:
            continue
        if is_warehouse_location(r.get("location_name")):
            continue
        color = (r.get("color_print") or r.get("color") or "—").strip() or "—"
        color_soh[(sn, color)] += float(r.get("available") or 0)

    out: List[Dict[str, Any]] = []
    for r in candidates:
        sn = r.get("style_name") or ""
        if not sn:
            continue
        # Find every color that either sold in last 30d or has SOH.
        colors = {k[1] for k in color_30d.keys() if k[0] == sn} | {k[1] for k in color_soh.keys() if k[0] == sn}
        if not colors:
            continue
        total_30d = style_total_30d.get(sn, 0)
        if total_30d <= 0:
            # No recent sales — skip; replen cools off otherwise.
            continue
        sell_rate_per_day = total_30d / 30.0
        color_rows = []
        total_replen = 0
        total_soh = 0.0
        for color in colors:
            u30 = color_30d.get((sn, color), 0)
            soh = color_soh.get((sn, color), 0.0)
            total_soh += soh
            color_rate = u30 / 30.0
            target = color_rate * 56.0  # 8 weeks of cover at recent rate
            rec = max(0, int(round(target - soh)))
            color_rows.append({
                "color": color,
                "units_30d": u30,
                "soh_total": int(soh),
                "target_qty": int(round(target)),
                "recommended_qty": rec,
                "pct_of_style_sales": round((u30 / total_30d * 100), 1) if total_30d else 0.0,
            })
            total_replen += rec
        if total_replen <= 0:
            continue
        color_rows.sort(key=lambda x: x["recommended_qty"], reverse=True)
        woc_calc = round((total_soh / sell_rate_per_day / 7), 2) if sell_rate_per_day else 999.0
        out.append({
            "style_name": sn,
            "brand": r.get("brand") or "",
            "subcategory": r.get("subcategory") or r.get("product_type") or "",
            "total_units_6m": int(r.get("units_sold") or 0),
            "total_units_30d": total_30d,
            "total_soh": int(total_soh),
            "sor_percent": round(float(r.get("sor_percent") or r.get("sor") or 0), 1),
            "weeks_of_cover": woc_calc,
            "sell_rate_per_day": round(sell_rate_per_day, 2),
            "colors": color_rows,
            "total_recommended_qty": total_replen,
        })
    out.sort(key=lambda r: r["total_recommended_qty"], reverse=True)
    return out


# ─── /analytics/aged-stock ────────────────────────────────────────────
@api_router.get("/analytics/aged-stock")
async def analytics_aged_stock(
    min_days_since_sale: int = Query(60, ge=0, le=365),
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Aged stock report — per-SKU view of inventory that has not been
    selling. Used by store ops teams to drive markdowns, IBT, returns
    or product-mix decisions.

    Output rows: {pos_location, product_name, size, barcode, sku,
    units_sold_180d, soh, soh_warehouse, days_since_last_sale}.

    Logic:
      • Fan out /orders for 180 days; per (location, sku) compute
        units_sold and max(order_date).
      • Walk fetch_all_inventory → one row per (location, sku) where
        SOH > 0. Join with the sales aggregate.
      • days_since_last_sale = today − max(order_date). If the SKU has
        NEVER sold in the look-back window we set it to 999 (treat as
        "never sold this period" / very aged).
      • Filter rows where days_since_last_sale ≥ min_days_since_sale.
      • Sort by days_since_last_sale desc, then SOH desc.

    `soh_warehouse` is the warehouse / holding-location stock for the
    same SKU (group-wide, not POS-scoped) so reorder/markdown decisions
    consider replenishable backstock too.
    """
    today = datetime.now(timezone.utc).date()
    look_from = (today - timedelta(days=180)).isoformat()
    rows = await _orders_for_window(look_from, today.isoformat(), country, channel)

    # Per (location, sku) sales aggregates.
    sales: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in rows:
        loc = r.get("pos_location_name") or r.get("channel") or ""
        sku = r.get("sku") or ""
        if not loc or not sku:
            continue
        key = (loc, sku)
        b = sales.setdefault(key, {"units": 0, "last_date": ""})
        b["units"] += int(r.get("quantity") or 0)
        od = (r.get("order_date") or "")[:10]
        if od and od > b["last_date"]:
            b["last_date"] = od

    inv = await fetch_all_inventory(country=country) or []
    chs = _split_csv(channel)
    chs_set = set(chs) if chs else None

    # Group warehouse stock per SKU (location-agnostic) — same SKU may sit
    # in multiple warehouses; sum them all.
    wh_by_sku: Dict[str, float] = defaultdict(float)
    for r in inv:
        if is_warehouse_location(r.get("location_name")):
            wh_by_sku[r.get("sku") or ""] += float(r.get("available") or 0)

    today_iso = today.isoformat()
    out: List[Dict[str, Any]] = []
    for r in inv:
        loc = r.get("location_name") or ""
        if not loc or is_warehouse_location(loc):
            continue
        if chs_set and loc not in chs_set:
            continue
        sku = r.get("sku") or ""
        if not sku:
            continue
        soh = float(r.get("available") or 0)
        if soh <= 0:
            continue
        agg = sales.get((loc, sku)) or {"units": 0, "last_date": ""}
        units_sold = agg["units"]
        last_date = agg["last_date"]
        if last_date:
            days = (datetime.strptime(today_iso, "%Y-%m-%d").date() -
                    datetime.strptime(last_date, "%Y-%m-%d").date()).days
        else:
            days = 999
        if days < min_days_since_sale:
            continue
        out.append({
            "pos_location": loc,
            "product_name": r.get("product_name") or r.get("style_name") or "",
            "color": r.get("color_print") or r.get("color") or "",
            "size": r.get("size") or "",
            "barcode": r.get("barcode") or "",
            "sku": sku,
            "units_sold_180d": int(units_sold),
            "soh": round(soh, 0),
            "soh_warehouse": round(wh_by_sku.get(sku, 0), 0),
            "days_since_last_sale": days,
            "last_sale_date": last_date or None,
        })
    out.sort(key=lambda x: (x["days_since_last_sale"], x["soh"]), reverse=True)
    return out
