"""
Per-user persistence for Re-Order / IBT recommendation action state.

Audit recommendation #5 (Close the loop): Re-Order and IBT lists were
stateless — a user could mark a SKU as "PO sent" yesterday and still see
it in the list today. This module persists per-user row state so the
list stays meaningful between sessions.

Collection: `recommendation_state`
Document shape (one per user × item_type × item_key):
    {
        user_id:    str,           # authenticated user.user_id
        item_type:  "reorder" | "ibt",
        item_key:   str,           # caller-supplied stable key (see below)
        status:     "pending"      # fresh, never acted on
                  | "po_raised"    # PO draft sent to supplier
                  | "dismissed"    # user explicitly skipped (optional reason)
                  | "done",        # fulfilled / received / completed
        note:       str | None,    # free-text (reason for dismissal etc)
        updated_at: datetime,
        updated_by_email: str,
    }

Stable item_key conventions (caller's responsibility):
- Re-order: style_name (case-sensitive)
- IBT:      "<style_name>||<from_location>||<to_location>"

Lookups are per-user; there is no cross-user visibility (intentional —
keeps workflows personal to the buyer / ops person). This can be relaxed
later by introducing a "team" dimension.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import db, get_current_user, User

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])

ITEM_TYPES = ("reorder", "ibt")
STATUSES = ("pending", "po_raised", "dismissed", "done")


class StatePayload(BaseModel):
    item_type: Literal["reorder", "ibt"]
    item_key: str = Field(..., min_length=1, max_length=400)
    status: Literal["pending", "po_raised", "dismissed", "done"]
    note: Optional[str] = Field(None, max_length=500)


class StateRow(BaseModel):
    item_type: str
    item_key: str
    status: str
    note: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by_email: Optional[str] = None


async def _ensure_index():
    try:
        await db.recommendation_state.create_index(
            [("user_id", 1), ("item_type", 1), ("item_key", 1)],
            unique=True, background=True,
        )
    except Exception:
        pass


@router.get("", response_model=List[StateRow])
async def list_state(
    item_type: Literal["reorder", "ibt"] = Query(...),
    user: User = Depends(get_current_user),
):
    """Return every row of state the caller has set for `item_type`.
    Pending is the implicit default, so rows not in the result should be
    treated as `pending` by the frontend."""
    await _ensure_index()
    rows: List[StateRow] = []
    async for doc in db.recommendation_state.find(
        {"user_id": user.user_id, "item_type": item_type},
        {"_id": 0, "user_id": 0},
    ):
        rows.append(StateRow(**doc))
    return rows


@router.post("", response_model=StateRow)
async def set_state(
    body: StatePayload,
    user: User = Depends(get_current_user),
):
    """Upsert a state row. Passing status='pending' deletes the row so
    the collection stays lean (pending = absence-of-record)."""
    await _ensure_index()
    now = datetime.now(timezone.utc)
    match = {
        "user_id": user.user_id,
        "item_type": body.item_type,
        "item_key": body.item_key,
    }
    if body.status == "pending":
        await db.recommendation_state.delete_one(match)
        return StateRow(
            item_type=body.item_type,
            item_key=body.item_key,
            status="pending",
            note=None,
            updated_at=now,
            updated_by_email=user.email,
        )

    doc = {
        **match,
        "status": body.status,
        "note": body.note,
        "updated_at": now,
        "updated_by_email": user.email,
    }
    await db.recommendation_state.update_one(match, {"$set": doc}, upsert=True)
    return StateRow(
        item_type=doc["item_type"],
        item_key=doc["item_key"],
        status=doc["status"],
        note=doc.get("note"),
        updated_at=doc["updated_at"],
        updated_by_email=doc["updated_by_email"],
    )


@router.delete("")
async def clear_state(
    item_type: Literal["reorder", "ibt"] = Query(...),
    item_key: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
):
    """Clear a single row (item_key supplied) or every row for the
    user × item_type (bulk reset)."""
    await _ensure_index()
    q = {"user_id": user.user_id, "item_type": item_type}
    if item_key:
        q["item_key"] = item_key
    res = await db.recommendation_state.delete_many(q)
    return {"deleted": res.deleted_count}
