"""
Marketing Intelligence — pure helper functions.

Computes slow-mover detection, location heatmap aggregation, and the
"suggested action" rule-engine used by the Marketing page.  All
functions are pure (no I/O, no Mongo, no upstream calls); the route
layer (`/app/backend/routes/marketing.py`) wires them to live data.

Definitions (per user-supplied SOP, Feb 2026):
  • SOR = units sold / (units sold + current stock) × 100
  • Slow-mover: SOR < 40 % over the last 14 days (yesterday inclusive)
  • Heatmap colour bands:
       green   SOR ≥ 60
       amber   40 ≤ SOR < 60
       red     SOR < 40
       grey    no stock
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Tuple


# Subcategory → high-level category mapping.  Mirrors
# /app/frontend/src/lib/productCategory.js — keep both files in lock-step
# when the merch taxonomy changes.
SUBCATEGORY_TO_CATEGORY: Dict[str, str] = {
    # Accessories — excluded from merchandise views
    "Accessories": "Accessories",
    "Bangles & Bracelets": "Accessories",
    "Belts": "Accessories",
    "Body Mists & Fragrances": "Accessories",
    "Earrings": "Accessories",
    "Necklaces": "Accessories",
    "Rings": "Accessories",
    "Scarves": "Accessories",
    # Bottoms
    "Culottes & Capri Pants": "Bottoms",
    "Full Length Pants": "Bottoms",
    "Jumpsuits & Playsuits": "Bottoms",
    "Leggings": "Bottoms",
    "Shorts & Skorts": "Bottoms",
    # Dresses
    "Knee Length Dresses": "Dresses",
    "Maxi Dresses": "Dresses",
    "Midi & Capri Dresses": "Dresses",
    "Short & Mini Dresses": "Dresses",
    # Mens
    "Men's Bottoms": "Mens",
    "Men's Tops": "Mens",
    # Outerwear
    "Hoodies & Sweatshirts": "Outerwear",
    "Jackets & Coats": "Outerwear",
    "Sweaters & Ponchos": "Outerwear",
    "Waterfalls & Kimonos": "Outerwear",
    # Sale — excluded
    "Sample & Sale Items": "Sale",
    # Skirts
    "Knee Length Skirts": "Skirts",
    "Maxi Skirts": "Skirts",
    "Midi & Capri Skirts": "Skirts",
    "Short & Mini Skirts": "Skirts",
    # Tops
    "Bodysuits": "Tops",
    "Fitted Tops": "Tops",
    "Loose Tops": "Tops",
    "Midriff & Crop Tops": "Tops",
    "T-shirts & Tank Tops": "Tops",
    # Two-piece sets
    "Pants & Top Set": "Two-Piece Sets",
    "Pants & Waterfall Set": "Two-Piece Sets",
    "Skirts & Top Set": "Two-Piece Sets",
}

NON_MERCH_CATEGORIES = {"Accessories", "Sale", "Other"}

# Categories shown on the heatmap, in display order.  Excludes
# non-merch buckets so marketing/merch focus on apparel.
MERCH_CATEGORIES: List[str] = [
    "Tops",
    "Bottoms",
    "Dresses",
    "Skirts",
    "Outerwear",
    "Two-Piece Sets",
    "Mens",
]


def category_for(subcat: Optional[str]) -> str:
    """Returns the high-level category for a subcategory string, or
    "Other" for anything unmapped."""
    if not subcat:
        return "Other"
    return SUBCATEGORY_TO_CATEGORY.get(subcat, "Other")


def is_warehouse_location(name: Optional[str]) -> bool:
    """Locations that should be excluded from the "where it's stocked"
    list per user spec ("exclude Warehouse Finished Goods location").
    Conservative regex to also drop staging/holding/wholesale buckets.

    Iter 91f — Online - Shop Zetu is an online-fulfilment stockholding
    location, classified as warehouse across the app. Keep this list
    in sync with `WAREHOUSE_KEYS` in server.py — server.py is the
    primary source of truth; this local copy exists only to avoid a
    server↔marketing_intel circular import.
    """
    if not name:
        return False
    s = name.lower()
    return any(tok in s for tok in (
        "warehouse",
        "wholesale",
        "holding",
        "staging",
        "sale stock",
        "online - shop zetu",
    ))


def aggregate_inventory_by_style(
    inventory_rows: Iterable[dict],
    *,
    exclude_warehouse: bool = False,
) -> Dict[str, dict]:
    """Roll up inventory rows into a per-style dict:
        {
          style_name: {
            "current_stock": int,
            "locations": [str, ...],     # de-duplicated, sorted
            "subcategory": str,
            "brand": str,
            "avg_price": float | None,   # not derivable from inventory alone
          }, ...
        }
    """
    by_style: Dict[str, dict] = {}
    locs: Dict[str, set] = defaultdict(set)
    for r in inventory_rows or []:
        style = r.get("style_name") or r.get("product_name")
        if not style:
            continue
        loc = r.get("location_name")
        if exclude_warehouse and is_warehouse_location(loc):
            continue
        avail = r.get("available") or 0
        if style not in by_style:
            by_style[style] = {
                "style_name": style,
                "current_stock": 0,
                "subcategory": r.get("product_type"),
                "brand": r.get("brand"),
                "collection": r.get("collection"),
            }
        by_style[style]["current_stock"] += avail
        if loc:
            locs[style].add(loc)
    for style, entry in by_style.items():
        entry["locations"] = sorted(locs.get(style, set()))
    return by_style


def suggested_action(
    sor_pct: float,
    stock: float,
    *,
    ibt_pair: Optional[dict] = None,
) -> str:
    """Rule-engine from user spec.  Returns a short imperative phrase
    the marketing team can read in the table.

    Iter 89w-i — `ibt_pair` (when supplied) is the active IBT
    recommendation for this style: {"from": "Vivo Sarit", "to": "Vivo
    Junction", "units": 3}.  When present, we surface it as the
    primary action.  When absent, the "Consider store transfer"
    branch is replaced with a markdown/feature recommendation — the
    IBT engine has already proven there's no viable destination
    store with same-style demand, so a transfer would just shift
    dead stock around.
    """
    if ibt_pair:
        u = ibt_pair.get("units") or 0
        u_label = f"{int(u)} unit{'s' if u != 1 else ''}" if u else "units"
        return f"Store transfer: {u_label} {ibt_pair.get('from')} → {ibt_pair.get('to')} (on IBT list)"
    if sor_pct < 20 and stock > 50:
        return "URGENT: Flash sale or markdown recommended"
    if sor_pct < 20:
        # No viable IBT pair — transfer would just shift dead stock.
        return "Mark down or feature in email/social campaign"
    if sor_pct < 40 and stock > 30:
        return "Recommend feature in email campaign or social push"
    return "Monitor — low risk"


def compute_slow_movers(
    sales_rows: Iterable[dict],
    inventory_by_style: Dict[str, dict],
    *,
    sor_threshold: float = 40.0,
    ibt_pair_by_style: Optional[Dict[str, dict]] = None,
) -> List[dict]:
    """Joins net-units-sold (from sales_rows; expects `style_name` +
    `units_sold` + `total_sales`) with the per-style inventory rollup
    and returns rows whose SOR % is BELOW the threshold.

    Output rows carry the full feature set the frontend needs:
      style_name, brand, subcategory, category, current_stock,
      units_sold, total_sales, avg_price, sor_percent, locations,
      stock_value_at_risk, suggested_action.

    Sorted by SOR ascending (worst first), matching the user spec.
    """
    out: List[dict] = []
    pairs = ibt_pair_by_style or {}
    # Seed with sales-driven styles first…
    seen = set()
    for r in sales_rows or []:
        style = r.get("style_name")
        if not style:
            continue
        seen.add(style)
        units = float(r.get("units_sold") or 0)
        inv = inventory_by_style.get(style, {})
        stock = float(inv.get("current_stock") or 0)
        denom = units + stock
        sor = (units / denom * 100.0) if denom else 0.0
        if sor >= sor_threshold:
            continue
        total_sales = float(r.get("total_sales") or 0)
        avg_price = (total_sales / units) if units else 0.0
        pair = pairs.get(style)
        out.append({
            "style_name": style,
            "brand": r.get("brand") or inv.get("brand"),
            "subcategory": r.get("product_type") or inv.get("subcategory"),
            "category": category_for(r.get("product_type") or inv.get("subcategory")),
            "current_stock": stock,
            "units_sold": units,
            "total_sales": total_sales,
            "avg_price": round(avg_price, 2) if avg_price else 0.0,
            "sor_percent": round(sor, 2),
            "locations": inv.get("locations") or [],
            "stock_value_at_risk": round(stock * avg_price, 2),
            "suggested_action": suggested_action(sor, stock, ibt_pair=pair),
            "on_ibt": bool(pair),
            "ibt_from": pair.get("from") if pair else None,
            "ibt_to": pair.get("to") if pair else None,
            "ibt_units": pair.get("units") if pair else None,
        })
    # …then styles that have stock but NO sales in the window.  Those
    # are the worst-of-the-worst (SOR = 0).  Skip those without a
    # subcategory (likely accessories / non-merch) since the heatmap
    # filters those out anyway.
    for style, inv in inventory_by_style.items():
        if style in seen:
            continue
        stock = float(inv.get("current_stock") or 0)
        if stock <= 0:
            continue
        subcat = inv.get("subcategory")
        cat = category_for(subcat)
        if cat in NON_MERCH_CATEGORIES:
            continue
        pair = pairs.get(style)
        out.append({
            "style_name": style,
            "brand": inv.get("brand"),
            "subcategory": subcat,
            "category": cat,
            "current_stock": stock,
            "units_sold": 0.0,
            "total_sales": 0.0,
            "avg_price": 0.0,
            "sor_percent": 0.0,
            "locations": inv.get("locations") or [],
            "stock_value_at_risk": 0.0,  # no avg_price to compute against
            "suggested_action": suggested_action(0.0, stock, ibt_pair=pair),
            "on_ibt": bool(pair),
            "ibt_from": pair.get("from") if pair else None,
            "ibt_to": pair.get("to") if pair else None,
            "ibt_units": pair.get("units") if pair else None,
        })
    out.sort(key=lambda r: r["sor_percent"])
    return out


def compute_heatmap(
    sales_rows: Iterable[dict],
    inventory_rows: Iterable[dict],
    *,
    categories: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Returns a (location × category) heatmap of SOR %.

    Sales side: rolled up by style → category, distributed equally
    across the locations that stock the style (we don't have per-
    location unit_sold breakdown in /top-skus).  This matches how the
    merch team thinks about it: "Tops moved well at Sarit overall"
    even when the upstream attribution is fuzzy.

    Stock side: rolled up by location × category.

    Output shape:
        {
          "locations": [str, ...],         # sorted alphabetically
          "categories": [str, ...],        # MERCH_CATEGORIES order
          "cells": {
             "<location>": {
                "<category>": {
                  "units_sold": int,
                  "current_stock": int,
                  "sor_percent": float | None,  # None when no stock
                },
                ...
             }, ...
          }
        }
    """
    cats = categories or MERCH_CATEGORIES

    # 1. Stock side: per-location per-category current stock.
    stock_cells: Dict[Tuple[str, str], float] = defaultdict(float)
    style_locations: Dict[str, List[str]] = defaultdict(list)
    style_category: Dict[str, str] = {}
    for r in inventory_rows or []:
        style = r.get("style_name") or r.get("product_name")
        loc = r.get("location_name")
        if not loc or is_warehouse_location(loc):
            continue
        subcat = r.get("product_type")
        cat = category_for(subcat)
        if cat not in cats:
            continue
        avail = float(r.get("available") or 0)
        stock_cells[(loc, cat)] += avail
        if style:
            if loc not in style_locations[style]:
                style_locations[style].append(loc)
            style_category[style] = cat

    # 2. Sales side: distribute style units across its current-stock
    # locations proportionally.  For styles that stock everywhere
    # equally this is just (units_sold / n_locations).
    sales_cells: Dict[Tuple[str, str], float] = defaultdict(float)
    for r in sales_rows or []:
        style = r.get("style_name")
        if not style:
            continue
        units = float(r.get("units_sold") or 0)
        if units <= 0:
            continue
        cat = style_category.get(style) or category_for(r.get("product_type"))
        if cat not in cats:
            continue
        locs = style_locations.get(style) or []
        if not locs:
            continue
        share = units / len(locs)
        for loc in locs:
            sales_cells[(loc, cat)] += share

    # 3. Materialise the grid.
    locations = sorted({loc for (loc, _) in stock_cells.keys()})
    cells: Dict[str, Dict[str, dict]] = {}
    for loc in locations:
        row: Dict[str, dict] = {}
        for cat in cats:
            stock = stock_cells.get((loc, cat), 0.0)
            units = sales_cells.get((loc, cat), 0.0)
            denom = stock + units
            sor = (units / denom * 100.0) if denom > 0 else None
            row[cat] = {
                "units_sold": round(units, 1),
                "current_stock": round(stock, 1),
                "sor_percent": round(sor, 1) if sor is not None else None,
            }
        cells[loc] = row

    return {
        "locations": locations,
        "categories": cats,
        "cells": cells,
    }
