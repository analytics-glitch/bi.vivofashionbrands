"""
Allocations module — distribute a fixed pool of units across stores
using a hybrid score (velocity + low-stock-need) and split each
store's allocation across sizes via the leadership-defined size pack
ratios.

Endpoints:
  GET  /api/allocations/sizes         - returns the size-pack ratio table
  GET  /api/allocations/stores        - candidate destination stores
  POST /api/allocations/calculate     - given units, sizes, color, subcat
                                        + window → per-store size-by-size
                                        suggestion table

Size pack ratios (provided by leadership):
  XS=1, S=2, M=3, L=3, 1X=2, 2X=1, F=4,
  XS/S=2, M/L=2, 1X/2X=1, S/M=2, L/1X=1

The full pack for a chosen size set = sum of those values. Each pack
is a complete size run; partial packs are not allowed (managers ship
in whole packs to keep the floor mix intact).
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import User, get_current_user
from server import (
    api_router,
    fetch_all_inventory,
    is_warehouse_location,
    _orders_for_window,
    INVENTORY_EXCLUDED_LOCATIONS,
    INVENTORY_EXCLUDED_BRANDS,
)


# ── Size-pack ratios ──────────────────────────────────────────────────
SIZE_PACK_TABLE: Dict[str, int] = {
    "XS": 1,
    "S": 2,
    "M": 3,
    "L": 3,
    "1X": 2,
    "2X": 1,
    "F": 4,
    "XS/S": 2,
    "M/L": 2,
    "1X/2X": 1,
    "S/M": 2,
    "L/1X": 1,
}

# Online channels never receive physical IBT/allocation (they ship
# from the warehouse direct to customers). Same exclusion list as
# Warehouse → Store IBT.
ONLINE_DEST_KEYS = ("online", "shop zetu", "studio", "wholesale")


def _norm_size(s: Optional[str]) -> str:
    """Normalise size strings so we can match upstream SKU sizes against
    our size-pack table. Upstream sometimes returns lowercase / extra
    spaces / "OS" for one-size."""
    if not s:
        return ""
    n = s.strip().upper().replace(" ", "")
    aliases = {
        "ONESIZE": "F",
        "OS": "F",
        "FREE": "F",
        "1XL": "1X",
        "2XL": "2X",
    }
    return aliases.get(n, n)


# ── Models ────────────────────────────────────────────────────────────
class AllocationRequest(BaseModel):
    subcategory: str = Field(..., min_length=1)
    color: Optional[str] = None  # optional — if provided, restricts
                                 # velocity + SOH to that colour only.
    sizes: List[str] = Field(..., min_items=1)  # e.g. ["S", "M", "L"]
    units_total: int = Field(..., ge=1, le=100000)
    date_from: str
    date_to: str
    velocity_weight: float = Field(0.5, ge=0, le=1)
    # 0 = pure low-stock fill, 1 = pure velocity. Default 0.5 = blend.
    excluded_stores: List[str] = []


class StoreAllocationRow(BaseModel):
    store: str
    score: float
    velocity_score: float
    low_stock_score: float
    units_sold_window: int
    current_soh: int
    packs_allocated: int
    units_allocated: int
    sizes: Dict[str, int]  # size → units


class AllocationResponse(BaseModel):
    pack_unit_size: int
    pack_breakdown: Dict[str, int]
    available_packs: int
    requested_units: int
    allocated_units: int
    leftover_units: int
    rows: List[StoreAllocationRow]


# ── Endpoints ─────────────────────────────────────────────────────────
@api_router.get("/allocations/sizes")
async def get_size_pack_table(_: User = Depends(get_current_user)):
    """Return the canonical size → pack-ratio table for the front-end
    chooser. Static — defined in this module."""
    return {"pack_table": SIZE_PACK_TABLE}


@api_router.get("/allocations/stores")
async def get_allocation_stores(_: User = Depends(get_current_user)):
    """Candidate destination stores — physical retail only, warehouses
    + online + excluded locations stripped. Sourced from /inventory so
    we never propose a store the system can't see stock for."""
    inv = await fetch_all_inventory()
    if not inv:
        return {"stores": []}
    seen = set()
    for r in inv:
        loc = r.get("location_name") or ""
        if not loc or loc in seen:
            continue
        if is_warehouse_location(loc):
            continue
        if loc.lower() in INVENTORY_EXCLUDED_LOCATIONS:
            continue
        if any(k in loc.lower() for k in ONLINE_DEST_KEYS):
            continue
        seen.add(loc)
    return {"stores": sorted(seen)}


def _round_pack_count(score: float, total_packs: int, totals_score: float) -> int:
    """Convert a continuous score into an integer pack count via
    largest-remainder rounding done by the caller. Here we just return
    the proportional allocation (caller normalises)."""
    if totals_score <= 0:
        return 0
    return int(round(score / totals_score * total_packs))


@api_router.post("/allocations/calculate", response_model=AllocationResponse)
async def calculate_allocation(
    body: AllocationRequest,
    _: User = Depends(get_current_user),
):
    """Allocate `units_total` units of a subcategory across stores
    using a velocity + low-stock blended score, returning a per-store
    per-size breakdown that sums to whole packs.
    """
    # 1) Validate sizes against our pack table.
    pack_breakdown: Dict[str, int] = {}
    for s in body.sizes:
        n = _norm_size(s)
        if n not in SIZE_PACK_TABLE:
            raise HTTPException(400, f"Unknown size '{s}' — must be one of {sorted(SIZE_PACK_TABLE)}")
        pack_breakdown[n] = SIZE_PACK_TABLE[n]
    pack_unit_size = sum(pack_breakdown.values())
    if pack_unit_size <= 0:
        raise HTTPException(400, "Pack size resolved to zero")
    available_packs = body.units_total // pack_unit_size
    if available_packs <= 0:
        raise HTTPException(
            400,
            f"{body.units_total} units < one pack ({pack_unit_size}). "
            f"Either send more units or pick fewer sizes.",
        )

    # 2) Pull velocity (sales) + SOH (inventory) in parallel.
    inv = await fetch_all_inventory()
    orders = await _orders_for_window(body.date_from, body.date_to, country=None)

    target_subcat = body.subcategory.strip().lower()
    target_color = (body.color or "").strip().lower() or None
    excluded = {s.strip() for s in body.excluded_stores if s and s.strip()}

    def _row_matches(r: dict) -> bool:
        sub = (r.get("product_type") or r.get("subcategory") or "").strip().lower()
        if sub != target_subcat:
            return False
        if target_color:
            color = (r.get("color_print") or r.get("color") or "").strip().lower()
            if target_color not in color:
                return False
        return True

    def _sales_matches(r: dict) -> bool:
        sub = (r.get("product_type") or r.get("subcategory") or "").strip().lower()
        if sub != target_subcat:
            return False
        if target_color:
            color = (r.get("color_print") or r.get("color") or "").strip().lower()
            if target_color not in color:
                return False
        return True

    # SOH per store for the matching subcategory/color.
    soh_by_store: Dict[str, int] = {}
    for r in (inv or []):
        loc = r.get("location_name") or ""
        if not loc or is_warehouse_location(loc) or loc in excluded:
            continue
        if loc.lower() in INVENTORY_EXCLUDED_LOCATIONS:
            continue
        if any(k in loc.lower() for k in ONLINE_DEST_KEYS):
            continue
        brand = (r.get("brand") or "").strip().lower()
        if brand in INVENTORY_EXCLUDED_BRANDS:
            continue
        if not _row_matches(r):
            continue
        soh_by_store[loc] = soh_by_store.get(loc, 0) + int(r.get("available") or 0)

    # Velocity per store from /orders.
    sold_by_store: Dict[str, int] = {}
    for r in (orders or []):
        store = r.get("pos_location_name") or r.get("channel") or ""
        if not store or is_warehouse_location(store) or store in excluded:
            continue
        if any(k in store.lower() for k in ONLINE_DEST_KEYS):
            continue
        if not _sales_matches(r):
            continue
        sold_by_store[store] = sold_by_store.get(store, 0) + int(r.get("quantity") or 0)

    candidate_stores = sorted(set(soh_by_store) | set(sold_by_store))
    if not candidate_stores:
        raise HTTPException(
            404,
            f"No stores have sold or stocked '{body.subcategory}'"
            + (f" in '{body.color}'" if body.color else "")
            + ". Try a wider date range or different filters.",
        )

    max_velocity = max((sold_by_store.get(s, 0) for s in candidate_stores), default=0)
    max_soh = max((soh_by_store.get(s, 0) for s in candidate_stores), default=0)

    # 3) Score = w·velocity + (1-w)·low-stock-need
    # Both normalised to [0,1] across the candidate set.
    rows: List[StoreAllocationRow] = []
    scores: List[Tuple[str, float]] = []
    for s in candidate_stores:
        v_norm = (sold_by_store.get(s, 0) / max_velocity) if max_velocity else 0.0
        # Low-stock score: stores with the LEAST stock for that subcat
        # get the highest score. We invert SOH then normalise.
        if max_soh > 0:
            ls_norm = 1.0 - (soh_by_store.get(s, 0) / max_soh)
        else:
            ls_norm = 1.0
        score = body.velocity_weight * v_norm + (1 - body.velocity_weight) * ls_norm
        scores.append((s, score))
    total_score = sum(sc for _, sc in scores) or 1.0

    # 4) Largest-remainder allocation of packs.
    raw = [(s, sc / total_score * available_packs) for s, sc in scores]
    floors = [(s, int(v)) for s, v in raw]
    remainders = sorted(
        ((s, v - int(v)) for s, v in raw),
        key=lambda x: x[1], reverse=True,
    )
    assigned = sum(f for _, f in floors)
    leftover = available_packs - assigned
    bonus = {s: 0 for s, _ in remainders}
    for s, _ in remainders[:max(0, leftover)]:
        bonus[s] += 1
    pack_count: Dict[str, int] = {s: f + bonus.get(s, 0) for s, f in floors}

    # 5) Build response rows.
    score_map = dict(scores)
    for s in candidate_stores:
        packs = pack_count.get(s, 0)
        sizes = {sz: packs * v for sz, v in pack_breakdown.items()}
        units = sum(sizes.values())
        rows.append(StoreAllocationRow(
            store=s,
            score=round(score_map[s], 4),
            velocity_score=round((sold_by_store.get(s, 0) / max_velocity) if max_velocity else 0.0, 4),
            low_stock_score=round((1.0 - (soh_by_store.get(s, 0) / max_soh)) if max_soh else 1.0, 4),
            units_sold_window=int(sold_by_store.get(s, 0)),
            current_soh=int(soh_by_store.get(s, 0)),
            packs_allocated=packs,
            units_allocated=units,
            sizes=sizes,
        ))

    rows.sort(key=lambda r: r.units_allocated, reverse=True)
    allocated = sum(r.units_allocated for r in rows)
    return AllocationResponse(
        pack_unit_size=pack_unit_size,
        pack_breakdown=pack_breakdown,
        available_packs=available_packs,
        requested_units=body.units_total,
        allocated_units=allocated,
        leftover_units=body.units_total - allocated,
        rows=rows,
    )


# Lightweight re-export so server.py picks this module up; importing
# the module triggers route registration on api_router.
router = api_router
