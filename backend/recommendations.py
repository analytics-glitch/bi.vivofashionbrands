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

from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import db, get_current_user, User

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])

ITEM_TYPES = ("reorder", "ibt", "dq")
STATUSES = ("pending", "po_raised", "dismissed", "done")


class StatePayload(BaseModel):
    item_type: Literal["reorder", "ibt", "dq"]
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
    item_type: Literal["reorder", "ibt", "dq"] = Query(...),
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
    item_type: Literal["reorder", "ibt", "dq"] = Query(...),
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


@router.get("/wins")
async def wins_this_window(
    # Default "this week" = last 7 days. `window_days` lets the frontend
    # render the same card for a daily/monthly variant if we ever want one.
    window_days: int = Query(7, ge=1, le=90),
    user: User = Depends(get_current_user),
):
    """
    Quiet-celebration rollup of how many recommendations the caller has
    resolved in the trailing N days. Feeds the "Wins this week" card on
    Overview. Pure count — no PO value joins (that requires snapshotting
    sales at action time; left for a future phase).

    Response shape:
        {
          "since":         "2026-04-17T00:00:00Z",
          "window_days":   7,
          "reorder_closed": 14,         # po_raised + done
          "reorder_dismissed": 3,
          "ibt_closed":    2,
          "ibt_dismissed": 1,
          "total_actions": 20,          # sum of the above
        }
    """
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "updated_at": {"$gte": since},
            "status": {"$in": ["po_raised", "done", "dismissed"]},
        }},
        {"$group": {
            "_id": {"item_type": "$item_type", "status": "$status"},
            "n": {"$sum": 1},
        }},
    ]
    buckets = {
        "reorder_closed": 0,
        "reorder_dismissed": 0,
        "ibt_closed": 0,
        "ibt_dismissed": 0,
    }
    async for doc in db.recommendation_state.aggregate(pipeline):
        it = doc["_id"]["item_type"]
        st = doc["_id"]["status"]
        n = int(doc["n"])
        if it == "reorder":
            if st == "dismissed":
                buckets["reorder_dismissed"] += n
            else:
                buckets["reorder_closed"] += n
        elif it == "ibt":
            if st == "dismissed":
                buckets["ibt_dismissed"] += n
            else:
                buckets["ibt_closed"] += n

    # Closed-loop streak — consecutive trailing days with ≥ 1 action.
    # Walks back from today (or yesterday, as a 1-day grace period so a
    # user who hasn't acted yet today doesn't lose their streak until
    # tomorrow — mirrors the visit-streak grace).
    streak_lookback_days = max(45, window_days)
    streak_since = datetime.now(timezone.utc) - timedelta(days=streak_lookback_days)
    active_days: set[str] = set()
    cursor = db.recommendation_state.find(
        {
            "user_id": user.user_id,
            "updated_at": {"$gte": streak_since},
            "status": {"$in": ["po_raised", "done", "dismissed"]},
        },
        {"_id": 0, "updated_at": 1},
    )
    async for doc in cursor:
        ts = doc.get("updated_at")
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            active_days.add(ts.strftime("%Y-%m-%d"))

    today = datetime.now(timezone.utc).date()
    today_key = today.strftime("%Y-%m-%d")
    yesterday_key = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    today_active = today_key in active_days
    if today_active:
        cur = today
    elif yesterday_key in active_days:
        cur = today - timedelta(days=1)
    else:
        cur = None

    action_streak = 0
    if cur is not None:
        while cur.strftime("%Y-%m-%d") in active_days:
            action_streak += 1
            cur = cur - timedelta(days=1)
            if action_streak > streak_lookback_days:
                break

    return {
        "since": since.isoformat(),
        "window_days": window_days,
        **buckets,
        "total_actions": sum(buckets.values()),
        "action_streak": action_streak,
        "today_active": today_active,
    }
