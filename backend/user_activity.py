"""
"What changed since your last visit" — user-visit snapshot store.

Audit recommendation #4 (warm start). Every authenticated /api/* request
already logs to activity_logs. Here we use that existing signal to
distinguish: was this user around in the last 10 minutes (still the
current session) vs was their last visit ≥ 2 hours ago (a genuine
return visit)?

The Overview page uses this to decide whether to show the "What's
changed since yesterday" belt or stay quiet.

Also emits a light summary payload the belt consumes directly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from auth import db, get_current_user, User

router = APIRouter(prefix="/api/user", tags=["user"])


@router.get("/last-visit")
async def last_visit(
    # ignore_recent_minutes controls what counts as "the current session".
    # Default 10 minutes — if the user has been clicking around in the last
    # 10 min we treat this as the same session and return no delta card.
    ignore_recent_minutes: int = Query(10, ge=0, le=120),
    user: User = Depends(get_current_user),
):
    """
    Returns the timestamp of the user's previous authenticated visit,
    excluding activity within the last `ignore_recent_minutes` minutes
    (i.e. ignoring *this* session). Shape:
      {
        "last_visit_at": "2026-04-23T18:42:10Z" | null,
        "hours_since":   14.3 | null,
        "is_warm_return": true | false,
        "first_ever":    true | false
      }
    `is_warm_return` is True when the gap is ≥ 2h but < 30d — i.e. the user
    has been around before but not in this sitting. The Overview belt only
    renders when this is True.
    """
    now = datetime.now(timezone.utc)
    recent_cut = now - timedelta(minutes=ignore_recent_minutes)
    # Find the most recent activity BEFORE `recent_cut`.
    cursor = db.activity_logs.find(
        {"user_id": user.user_id, "ts": {"$lt": recent_cut}},
        {"_id": 0, "ts": 1},
    ).sort("ts", -1).limit(1)
    docs = await cursor.to_list(length=1)
    if not docs:
        return {
            "last_visit_at": None,
            "hours_since": None,
            "is_warm_return": False,
            "first_ever": True,
        }
    ts: Optional[datetime] = docs[0].get("ts")
    if not isinstance(ts, datetime):
        return {
            "last_visit_at": None,
            "hours_since": None,
            "is_warm_return": False,
            "first_ever": True,
        }
    # Motor returns naive UTC datetimes — normalise before math.
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    hours = (now - ts).total_seconds() / 3600.0
    warm = 2 <= hours <= 24 * 30  # 2h – 30d window
    return {
        "last_visit_at": ts.isoformat(),
        "hours_since": round(hours, 2),
        "is_warm_return": bool(warm),
        "first_ever": False,
    }
