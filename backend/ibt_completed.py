"""
IBT completed-moves module — once a user fills in PO / transfer date /
their name and clicks "Mark as Done" on a suggested move, the row is
recorded in the `ibt_completed_moves` collection. The IBT page then:

  • hides the row from the live suggestions table (it's been actioned)
  • appends it to the "Completed Moves" report below (admin-only)

Schema:
  {
    _id, id (uuid),
    style_name, brand, subcategory,
    from_store, to_store,
    units_to_move,            # the originally-suggested qty
    actual_units_moved,       # what the picker shipped (≤ suggested)
    suggested_at,             # day suggestion appeared (today by default
                              # since suggestions are recomputed live)
    completed_at,             # day the user marked it done
    days_lapsed,              # (completed_at - suggested_at).days
    po_number,
    completed_by_name,        # the person filling the form
    completed_by_user_id,     # session user (audit)
    flow,                     # "store_to_store" | "warehouse_to_store"
  }
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, date, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from auth import User, get_current_user


_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]
_coll = _db.ibt_completed_moves
# Tracks first-seen timestamp for each (style, from_store, to_store)
# suggestion so we can compute "Late transfers" — moves that the
# system has been suggesting for more than N days but nobody has marked
# done yet.
_seen_coll = _db.ibt_suggestions_seen


class CompleteMoveBody(BaseModel):
    style_name: str
    brand: Optional[str] = None
    subcategory: Optional[str] = None
    from_store: str
    to_store: str
    units_to_move: int = Field(..., ge=1)
    actual_units_moved: int = Field(..., ge=1)
    po_number: str = Field(..., min_length=1, max_length=200)
    completed_by_name: str = Field(..., min_length=1, max_length=200)
    transfer_date: str  # YYYY-MM-DD
    suggested_date: Optional[str] = None  # defaults to today if absent
    flow: str = Field("store_to_store", pattern="^(store_to_store|warehouse_to_store)$")
    # Optional SKU-level identifiers — present when the user clicks Mark
    # As Done from a flat (per-SKU) row in the IBT page.
    sku: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    barcode: Optional[str] = None


class CompletedMove(BaseModel):
    id: str
    style_name: str
    brand: Optional[str] = None
    subcategory: Optional[str] = None
    from_store: str
    to_store: str
    units_to_move: int
    actual_units_moved: int
    suggested_at: datetime
    completed_at: datetime
    days_lapsed: int
    po_number: str
    completed_by_name: str
    completed_by_user_id: str
    flow: str
    sku: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    barcode: Optional[str] = None


router = APIRouter(prefix="/api/ibt", tags=["ibt"])


def _strip(d: dict) -> dict:
    if d is None:
        return d
    d.pop("_id", None)
    return d


def _parse_date(s: str) -> datetime:
    """Parse YYYY-MM-DD into a UTC midnight datetime so we can do date
    arithmetic without TZ surprises."""
    try:
        d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return d
    except Exception:
        raise HTTPException(400, f"Invalid date '{s}' (expected YYYY-MM-DD)")


@router.post("/complete", response_model=CompletedMove)
async def complete_move(body: CompleteMoveBody, user: User = Depends(get_current_user)):
    """Mark a suggested move as actually executed. Persists in
    `ibt_completed_moves` and computes days_lapsed for reporting.
    """
    if body.actual_units_moved > body.units_to_move:
        raise HTTPException(400, "actual_units_moved cannot exceed units_to_move")
    completed_at = _parse_date(body.transfer_date)
    suggested_at = _parse_date(body.suggested_date) if body.suggested_date else datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    if completed_at < suggested_at:
        raise HTTPException(400, "transfer_date cannot be earlier than suggested_date")
    days_lapsed = (completed_at.date() - suggested_at.date()).days

    fid = str(uuid.uuid4())
    doc = {
        "id": fid,
        "style_name": body.style_name,
        "brand": body.brand,
        "subcategory": body.subcategory,
        "from_store": body.from_store,
        "to_store": body.to_store,
        "units_to_move": body.units_to_move,
        "actual_units_moved": body.actual_units_moved,
        "suggested_at": suggested_at,
        "completed_at": completed_at,
        "days_lapsed": days_lapsed,
        "po_number": body.po_number.strip(),
        "completed_by_name": body.completed_by_name.strip(),
        "completed_by_user_id": user.user_id,
        "flow": body.flow,
        "sku": body.sku,
        "color": body.color,
        "size": body.size,
        "barcode": body.barcode,
        "created_at": datetime.now(timezone.utc),
    }
    await _coll.insert_one(doc)
    return _strip(doc)


@router.get("/completed", response_model=List[CompletedMove])
async def list_completed(user: User = Depends(get_current_user)):
    """Admin + Exec — list every completed move, newest first.

    Iter 78: Exec role now has audit access to this report so leadership
    can spot-check IBT execution without an admin handoff. Lower roles
    still hit a 403 (the lightweight `/completed/keys` endpoint is the
    one any role can call for the "hide already-completed" UI logic).
    """
    role = (user.role or "viewer").lower()
    if role not in ("admin", "exec"):
        raise HTTPException(status_code=403, detail="Admin or Exec role required")
    cursor = _coll.find({}, {"_id": 0}).sort("completed_at", -1).limit(2000)
    return [doc async for doc in cursor]


@router.get("/completed/keys")
async def list_completed_keys(user: User = Depends(get_current_user)):
    """Lightweight listing of already-actioned suggestions — used by
    the IBT page (any role) to hide already-completed SKUs from the
    live table. Returns:

    - `keys`         : "<style>||<to_store>" pairs (legacy)
    - `sku_keys`     : "<style>||<to_store>||<sku>" — SKU-granular,
                       used by the new flat IBT table so marking one
                       SKU done doesn't suppress its sibling SKUs.

    Scoped to the last 30 days so a transfer that was already done
    months ago doesn't permanently suppress a fresh recommendation.
    """
    from datetime import timedelta
    since = datetime.now(timezone.utc) - timedelta(days=30)
    cursor = _coll.find(
        {"completed_at": {"$gte": since}},
        {"_id": 0, "style_name": 1, "to_store": 1, "sku": 1},
    )
    keys = set()
    sku_keys = set()
    async for doc in cursor:
        st = doc.get("style_name")
        ts = doc.get("to_store")
        sk = doc.get("sku")
        if st and ts:
            keys.add(f"{st}||{ts}")
            if sk:
                sku_keys.add(f"{st}||{ts}||{sk}")
            else:
                # Legacy row without SKU — treat as "all SKUs of this
                # parent already done".
                keys.add(f"{st}||{ts}||__all__")
    return {"keys": list(keys), "sku_keys": list(sku_keys)}


# ── First-seen tracking + late-count ────────────────────────────────
async def track_suggestion_seen(style_name: str, from_store: str, to_store: str):
    """Record (or no-op) the first time we surfaced this exact transfer
    suggestion. Called by /ibt-suggestions + /ibt-warehouse-to-store
    after dedupe so the seen collection captures the canonical signal.
    """
    if not (style_name and from_store and to_store):
        return
    now = datetime.now(timezone.utc)
    key = f"{style_name}||{from_store}||{to_store}"
    await _seen_coll.update_one(
        {"_id": key},
        {
            "$setOnInsert": {
                "_id": key,
                "style_name": style_name,
                "from_store": from_store,
                "to_store": to_store,
                "first_seen": now,
            },
            "$set": {"last_seen": now},
        },
        upsert=True,
    )


async def get_seen_map_for(suggestions):
    """Return a dict keyed by `<style>||<from>||<to>` with the first_seen
    datetime for each suggestion that's been recorded by the tracker.
    Used to attach `days_lapsed` to the live suggestion endpoints.
    """
    if not suggestions:
        return {}
    keys = set()
    for s in suggestions:
        if not isinstance(s, dict):
            continue
        st = s.get("style_name"); fs = s.get("from_store"); ts = s.get("to_store")
        if st and fs and ts:
            keys.add(f"{st}||{fs}||{ts}")
    if not keys:
        return {}
    out = {}
    cursor = _seen_coll.find(
        {"_id": {"$in": list(keys)}},
        {"_id": 1, "first_seen": 1},
    )
    async for d in cursor:
        out[d["_id"]] = d.get("first_seen")
    return out


async def track_suggestions_batch(suggestions):
    """Bulk-friendly tracker — fire-and-forget batch upsert."""
    import asyncio as _asyncio
    if not suggestions:
        return
    tasks = []
    for s in suggestions:
        st = s.get("style_name") if isinstance(s, dict) else None
        fs = s.get("from_store") if isinstance(s, dict) else None
        ts = s.get("to_store") if isinstance(s, dict) else None
        if not (st and fs and ts):
            continue
        tasks.append(track_suggestion_seen(st, fs, ts))
    if tasks:
        await _asyncio.gather(*tasks, return_exceptions=True)


@router.get("/late-count")
async def late_transfer_count(days: int = 5, user: User = Depends(get_current_user)):
    """Count of suggestions first seen >`days` days ago that still
    haven't been marked done. Powers the red badge on the IBT nav
    item — surfaces stuck transfers that nobody has actioned.
    """
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(max(1, days)))

    # All "old" seen keys.
    seen_keys = []
    cursor = _seen_coll.find(
        {"first_seen": {"$lte": cutoff}},
        {"_id": 1, "style_name": 1, "to_store": 1, "first_seen": 1},
    )
    async for d in cursor:
        seen_keys.append({
            "style_to_key": f"{d.get('style_name')}||{d.get('to_store')}",
            "first_seen": d.get("first_seen"),
            "style_name": d.get("style_name"),
            "to_store": d.get("to_store"),
        })

    # Subtract the ones already marked done (any time).
    completed_pairs = set()
    async for d in _coll.find({}, {"_id": 0, "style_name": 1, "to_store": 1}):
        completed_pairs.add(f"{d.get('style_name')}||{d.get('to_store')}")

    late = [s for s in seen_keys if s["style_to_key"] not in completed_pairs]
    return {
        "count": len(late),
        "threshold_days": int(days),
        "items": late[:50],  # cap payload — only the worst 50 surface
    }
