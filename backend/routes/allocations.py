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

from typing import Any, Dict, List, Optional, Tuple

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
    color: Optional[str] = None
    sizes: List[str] = Field(..., min_items=1)
    units_total: int = Field(..., ge=1, le=100000)
    date_from: str
    date_to: str
    velocity_weight: float = Field(0.5, ge=0, le=1)
    excluded_stores: List[str] = []
    # New fields
    style_name: Optional[str] = None  # free-text label, persisted with
                                      # the saved run for the report.
    allocation_type: str = Field("new", pattern="^(new|replenishment)$")
    # When allocation_type == "replenishment", we filter velocity + SOH
    # by this exact style name (in addition to subcategory) so the
    # signal is style-specific, not subcategory-wide.


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
    target_style = (body.style_name or "").strip().lower() if body.allocation_type == "replenishment" else None

    def _row_matches(r: dict) -> bool:
        sub = (r.get("product_type") or r.get("subcategory") or "").strip().lower()
        if sub != target_subcat:
            return False
        if target_color:
            color = (r.get("color_print") or r.get("color") or "").strip().lower()
            if target_color not in color:
                return False
        # Replenishment: style-specific signal.
        if target_style:
            style = (r.get("style_name") or r.get("title") or "").strip().lower()
            if target_style not in style:
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
        if target_style:
            style = (r.get("style_name") or r.get("title") or "").strip().lower()
            if target_style not in style:
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


# ── Replenishment style picker + saved runs ─────────────────────────
import os
import uuid as _uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

_alloc_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
_alloc_db = _alloc_client[os.environ["DB_NAME"]]
_alloc_runs = _alloc_db.allocation_runs


@api_router.get("/allocations/styles")
async def list_replenishment_styles(
    subcategory: Optional[str] = None,
    _: User = Depends(get_current_user),
):
    """Return distinct style names the user can pick for a
    REPLENISHMENT allocation. Sourced from current inventory rows so we
    only surface styles that actually exist somewhere in stock right
    now. When `subcategory` is given, narrow to that subcategory.
    """
    inv = await fetch_all_inventory()
    if not inv:
        return {"styles": []}
    target = (subcategory or "").strip().lower()
    seen = set()
    for r in inv:
        sub = (r.get("product_type") or r.get("subcategory") or "").strip().lower()
        if target and sub != target:
            continue
        st = (r.get("style_name") or r.get("title") or "").strip()
        if st:
            seen.add(st)
    return {"styles": sorted(seen)}


class SaveAllocationRun(BaseModel):
    style_name: str = Field(..., min_length=1, max_length=300)
    allocation_type: str = Field("new", pattern="^(new|replenishment)$")
    subcategory: str
    color: Optional[str] = None
    units_total: int
    pack_unit_size: int
    pack_breakdown: Dict[str, int]
    velocity_weight: float
    date_from: str
    date_to: str
    rows: List[Dict[str, Any]]
    # rows must include both `suggested_units` and `allocated_units`
    # per store so the variance report can compare them later.


@api_router.post("/allocations/save")
async def save_allocation_run(
    body: SaveAllocationRun,
    user: User = Depends(get_current_user),
):
    """Persist a buying-plan allocation run to `allocation_runs`. The
    new doc starts in status `pending_fulfilment` so the warehouse
    team can pick it up, fill in size-level actuals, then confirm.
    Allocated_total is initially equal to suggested_total (warehouse
    will overwrite each row when they confirm).
    """
    rid = str(_uuid.uuid4())
    suggested_total = sum(int(r.get("suggested_units") or 0) for r in body.rows)
    # Buying plan = what the buyer asked for. Warehouse hasn't yet
    # confirmed actuals so we mirror suggested → allocated until they
    # do. Each row also gets a `warehouse_sizes` dict (initially equal
    # to the buying-plan sizes) which the warehouse will overwrite at
    # the size level on PATCH /fulfil.
    rows_with_wh = []
    for r in body.rows:
        copy = dict(r)
        copy.setdefault("buying_packs", copy.get("allocated_packs"))
        copy.setdefault("buying_units", copy.get("allocated_units"))
        copy.setdefault("buying_sizes", dict(copy.get("sizes") or {}))
        # Warehouse-stage placeholders — overwritten on /fulfil.
        copy["warehouse_sizes"] = dict(copy.get("buying_sizes") or {})
        copy["warehouse_units"] = sum(int(v or 0) for v in copy["warehouse_sizes"].values())
        rows_with_wh.append(copy)

    doc = {
        "id": rid,
        "style_name": body.style_name.strip(),
        "allocation_type": body.allocation_type,
        "subcategory": body.subcategory,
        "color": body.color,
        "units_total": body.units_total,
        "pack_unit_size": body.pack_unit_size,
        "pack_breakdown": body.pack_breakdown,
        "velocity_weight": body.velocity_weight,
        "date_from": body.date_from,
        "date_to": body.date_to,
        "rows": rows_with_wh,
        "suggested_total": suggested_total,
        "allocated_total": suggested_total,  # mirrors until fulfilled
        "delta_total": 0,
        "status": "pending_fulfilment",
        "created_at": datetime.now(timezone.utc),
        "created_by_user_id": user.user_id,
        "created_by_email": user.email,
        "created_by_name": user.name,
        "fulfilled_at": None,
        "fulfilled_by_user_id": None,
        "fulfilled_by_email": None,
        "fulfilled_by_name": None,
    }
    await _alloc_runs.insert_one(doc)
    doc.pop("_id", None)
    return doc


class FulfilAllocationBody(BaseModel):
    """Payload sent by the warehouse team when they confirm what was
    actually shipped per store at the size level. `rows` is a list of
    {store, sizes:{S:6, M:12, L:10}}. Sizes can include any subset of
    the original buying-plan sizes (zero is allowed).
    """
    rows: List[Dict[str, Any]] = Field(..., min_items=1)


@api_router.patch("/allocations/runs/{run_id}/fulfil")
async def fulfil_allocation_run(
    run_id: str,
    body: FulfilAllocationBody,
    user: User = Depends(get_current_user),
):
    """Warehouse-stage save: accepts per-store, per-size actuals and
    flips the run status to `fulfilled`. Any size whose qty is missing
    from the payload defaults to 0 (warehouse explicitly couldn't
    ship that size)."""
    doc = await _alloc_runs.find_one({"id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Allocation run not found")
    if doc.get("status") == "fulfilled":
        raise HTTPException(400, "Run already fulfilled")

    # Index incoming rows by store name for an O(1) merge below.
    incoming = {}
    for r in body.rows:
        store = (r.get("store") or "").strip()
        if not store:
            continue
        sizes = {k: int(v or 0) for k, v in (r.get("sizes") or {}).items()}
        incoming[store] = sizes

    new_rows = []
    allocated_total = 0
    for r in (doc.get("rows") or []):
        store = r.get("store")
        wh_sizes = incoming.get(store, dict(r.get("warehouse_sizes") or {}))
        wh_units = sum(int(v or 0) for v in wh_sizes.values())
        merged = dict(r)
        merged["warehouse_sizes"] = wh_sizes
        merged["warehouse_units"] = wh_units
        # Allocated stays as the warehouse-confirmed actual.
        merged["allocated_units"] = wh_units
        # `allocated_packs` is informational once warehouse breaks the
        # strict pack ratio, so we approximate by floor-dividing
        # warehouse_units by pack_unit_size.
        merged["allocated_packs"] = (
            wh_units // doc.get("pack_unit_size", 1)
            if doc.get("pack_unit_size") else 0
        )
        merged["sizes"] = wh_sizes  # legacy field kept in sync
        merged["delta_units"] = wh_units - int(merged.get("suggested_units") or 0)
        new_rows.append(merged)
        allocated_total += wh_units

    suggested_total = doc.get("suggested_total") or 0
    upd = {
        "rows": new_rows,
        "allocated_total": allocated_total,
        "delta_total": allocated_total - suggested_total,
        "status": "fulfilled",
        "fulfilled_at": datetime.now(timezone.utc),
        "fulfilled_by_user_id": user.user_id,
        "fulfilled_by_email": user.email,
        "fulfilled_by_name": user.name,
    }
    result = await _alloc_runs.find_one_and_update(
        {"id": run_id},
        {"$set": upd},
        return_document=True,
        projection={"_id": 0},
    )
    return result


@api_router.get("/allocations/runs")
async def list_allocation_runs(
    status: Optional[str] = None,
    _: User = Depends(get_current_user),
):
    """Return the latest 200 saved allocation runs. Optional `status`
    filter for `pending_fulfilment` / `fulfilled` so the warehouse
    inbox can pull just the open queue."""
    q = {}
    if status in ("pending_fulfilment", "fulfilled"):
        q["status"] = status
    cursor = _alloc_runs.find(q, {"_id": 0}).sort("created_at", -1).limit(200)
    return [doc async for doc in cursor]


@api_router.get("/allocations/runs/{run_id}")
async def get_allocation_run(run_id: str, _: User = Depends(get_current_user)):
    """Return a single allocation run for export rendering."""
    doc = await _alloc_runs.find_one({"id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Allocation run not found")
    return doc


# Lightweight re-export so server.py picks this module up; importing
# the module triggers route registration on api_router.
router = api_router
