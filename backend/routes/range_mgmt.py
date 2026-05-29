"""
Range Management routes — 4-Tier framework classification.

Endpoints under /api/range-mgmt/*.  Pure compute is in
`/app/backend/range_mgmt.py`; this module wires
`/api/analytics/sor-all-styles` data through the helpers and persists
tier history to Mongo so movement tracking works across sessions.

Endpoints:
  GET /api/range-mgmt/classify         — full classification payload
                                          {summary, rows, retirement_pipeline}
  GET /api/range-mgmt/movements        — tier changes in last N days
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# Late import — server.py owns the api_router.
from server import api_router, logger, analytics_sor_all_styles  # type: ignore
from auth import db
from range_mgmt import (
    classify_all,
    summarise,
    retirement_pipeline,
    diff_movements,
)


_HIST_COLL = "style_tier_history"


async def _ensure_indexes() -> None:
    try:
        await db[_HIST_COLL].create_index([("style_name", 1), ("changed_at", -1)])
        await db[_HIST_COLL].create_index("changed_at")
    except Exception as e:  # pragma: no cover
        logger.debug("[range-mgmt] index ensure: %s", e)


async def _load_prev_tier_map() -> Dict[str, str]:
    """Latest persisted tier per style.  Fast — uses the compound
    (style_name, changed_at desc) index."""
    out: Dict[str, str] = {}
    pipeline = [
        {"$sort": {"style_name": 1, "changed_at": -1}},
        {"$group": {
            "_id": "$style_name",
            "tier": {"$first": "$tier"},
        }},
    ]
    async for doc in db[_HIST_COLL].aggregate(pipeline):
        out[doc["_id"]] = doc["tier"]
    return out


async def _record_movements(movements: List[dict]) -> None:
    """Append a row per movement so we can query "tier changes in the
    last 30 days" later.  Idempotent — duplicates in the same minute
    are deduped by the (style_name, to_tier, calendar-day) check."""
    if not movements:
        return
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    docs = []
    for m in movements:
        # Skip if we've already logged this exact movement today.
        existing = await db[_HIST_COLL].find_one({
            "style_name": m["style_name"],
            "tier": m["to_tier"],
            "changed_at": {"$gte": today_start},
        })
        if existing:
            continue
        docs.append({
            "style_name": m["style_name"],
            "brand": m["brand"],
            "subcategory": m["subcategory"],
            "tier": m["to_tier"],
            "prev_tier": m["from_tier"],
            "direction": m["direction"],
            "style_age_weeks": m["style_age_weeks"],
            "lifetime_sor_pct": m["lifetime_sor_pct"],
            "changed_at": now,
        })
    if docs:
        try:
            await db[_HIST_COLL].insert_many(docs, ordered=False)
        except Exception as e:
            logger.warning("[range-mgmt] insert_many failed: %s", e)


@api_router.get("/range-mgmt/classify")
async def classify(
    include_retired: bool = False,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    """Full classification payload — summary, all classified rows,
    and the retirement pipeline.  Compares against the persisted tier
    history to detect movements (idempotent — only logs new moves).
    """
    await _ensure_indexes()

    # Reuse the existing /analytics/sor-all-styles endpoint function.
    # Calling it directly gives us its caching + retired-styles
    # annotation for free.  `style_status=None` returns all rows
    # annotated (with style_status + retired_at fields) so we can
    # filter ourselves below.
    sor_rows = await analytics_sor_all_styles(
        country=country, channel=channel, brand=None, refresh=False,
        style_status=None,
    )

    classified = classify_all(sor_rows or [], include_retired=include_retired)

    # Detect movements (vs the LATEST persisted tier per style) and
    # log them so the /movements endpoint can serve last-30-days
    # trends without re-classifying.
    prev_map = await _load_prev_tier_map()
    moves = diff_movements(classified, prev_map)
    await _record_movements(moves)

    summary = summarise(classified)
    pipeline = retirement_pipeline(classified)

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "rows": classified,
        "retirement_pipeline": pipeline,
        "recent_movements": moves[:200],  # cap for response size
    }


@api_router.get("/range-mgmt/movements")
async def list_movements(days: int = 30, limit: int = 500):
    """Tier changes recorded in the last `days` days.  Reads from the
    style_tier_history Mongo collection (cheap)."""
    await _ensure_indexes()
    since = datetime.now(timezone.utc) - timedelta(days=int(days))
    rows: List[dict] = []
    cursor = db[_HIST_COLL].find(
        {"changed_at": {"$gte": since}},
        {"_id": 0},
    ).sort("changed_at", -1).limit(int(limit))
    async for doc in cursor:
        # Mongo datetimes — surface as ISO strings for the FE.
        ca = doc.get("changed_at")
        if isinstance(ca, datetime):
            doc["changed_at"] = ca.astimezone(timezone.utc).isoformat()
        rows.append(doc)
    return {"days": days, "count": len(rows), "rows": rows}
