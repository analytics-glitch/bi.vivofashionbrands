"""
Marketing Intelligence routes — slow movers, location heatmap, and the
action-plan flag tracker.

All endpoints live under /api/marketing/*.  Pure compute lives in
`/app/backend/marketing_intel.py`; this file wires upstream sales +
inventory data into those helpers and persists action-plan flags to
Mongo so the marketing team's work survives across devices/users.

Endpoints:
  GET   /api/marketing/slow-movers     — slow movers + auto-flag
  GET   /api/marketing/heatmap         — location × category SOR grid
  GET   /api/marketing/flags           — list all flag docs
  POST  /api/marketing/flags/{style}   — upsert a flag (manual flag)
  PATCH /api/marketing/flags/{style}   — update action_status / notes
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field

# Late import — server.py imports this module AFTER its helpers exist.
from server import api_router, _split_csv, _get_top_skus_live, fetch_all_inventory, logger
from auth import db, get_current_user, User
from retired_styles import is_retired
from marketing_intel import (
    aggregate_inventory_by_style,
    compute_slow_movers,
    compute_heatmap,
    suggested_action,
    category_for,
    MERCH_CATEGORIES,
    NON_MERCH_CATEGORIES,
)


# ─── Mongo collection ───────────────────────────────────────────────
# One document per (style_name).  Created lazily on first slow-mover
# detection; updated whenever the style is re-evaluated.
_COLL = "marketing_slow_mover_flags"


async def _ensure_indexes() -> None:
    """Idempotent — safe to call from every request, the driver
    de-dupes by name."""
    try:
        await db[_COLL].create_index("style_name", unique=True)
        await db[_COLL].create_index("action_status")
    except Exception as e:  # pragma: no cover — index already exists
        logger.debug("[marketing] index ensure: %s", e)


# ─── Schema ─────────────────────────────────────────────────────────
class FlagUpdate(BaseModel):
    action_status: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).date().isoformat()


def _today() -> datetime:
    return datetime.now(timezone.utc)


def _flag_doc_for_response(doc: dict) -> dict:
    """Drop Mongo's `_id` and normalise datetime → ISO."""
    out = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("created_at", "updated_at", "last_seen_at"):
        v = out.get(k)
        if isinstance(v, datetime):
            out[k] = v.astimezone(timezone.utc).isoformat()
    return out


def _status_band(flagged_date: str, sor_now: float, sor_at_flag: float) -> str:
    """Lifecycle status used to colour the alert table."""
    try:
        fd = datetime.fromisoformat(flagged_date).date()
    except Exception:
        return "New"
    days = (datetime.now(timezone.utc).date() - fd).days
    delta = sor_now - sor_at_flag
    if days <= 1:
        return "New"
    if days >= 7 and delta < 10:
        return "Critical"
    if delta >= 10:
        return "Improving"
    return "Monitored"


# ─── Slow movers ────────────────────────────────────────────────────
@api_router.get("/marketing/slow-movers")
async def get_slow_movers(
    days: int = 14,
    threshold: float = 40.0,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    include_retired: bool = False,
):
    """Returns the slow-movers alert table + a summary banner.

    Auto-flags first-time appearances by inserting Mongo docs in
    `marketing_slow_mover_flags`.  Re-evaluates existing flags and
    surfaces the SOR delta + lifecycle status so the marketing team
    can see who is improving and who needs escalation.
    """
    await _ensure_indexes()

    # Dynamic 2-week window — today minus `days` to YESTERDAY.
    today = datetime.now(timezone.utc).date()
    date_to = (today - timedelta(days=1)).isoformat()
    date_from = (today - timedelta(days=days)).isoformat()

    # Fetch sales + inventory in parallel-ish (motor pools).
    sales_rows = await _get_top_skus_live(
        date_from=date_from, date_to=date_to,
        country=country, channel=channel, brand=None, limit=10000,
    )
    inventory_rows = await fetch_all_inventory(
        country=country, location=None, product=None,
        locations=_split_csv(channel) if channel else None,
    )

    # Roll up inventory excluding the Warehouse Finished Goods bucket
    # per spec.
    inv_by_style = aggregate_inventory_by_style(
        inventory_rows, exclude_warehouse=True,
    )

    # Drop retired styles unless explicitly asked for.
    if not include_retired:
        sales_rows = [r for r in (sales_rows or []) if not is_retired(r.get("style_name"))]
        inv_by_style = {k: v for k, v in inv_by_style.items() if not is_retired(k)}

    rows = compute_slow_movers(sales_rows, inv_by_style, sor_threshold=threshold)

    # Pull existing flags in one Mongo round-trip.
    existing = {}
    async for doc in db[_COLL].find({"style_name": {"$in": [r["style_name"] for r in rows]}}):
        existing[doc["style_name"]] = doc

    # Annotate + auto-flag new ones.
    to_insert: List[dict] = []
    to_update_now: List[Any] = []
    enriched: List[dict] = []
    now = _today()
    today_iso = _iso(now)
    for r in rows:
        prev = existing.get(r["style_name"])
        if prev:
            sor_at_flag = float(prev.get("sor_at_flag") or r["sor_percent"])
            flagged_date = prev.get("flagged_date") or today_iso
            action_status = prev.get("action_status") or "pending"
            notes = prev.get("notes") or ""
            to_update_now.append({
                "filter": {"_id": prev["_id"]},
                "update": {
                    "$set": {
                        "last_seen_at": now,
                        "last_seen_sor": r["sor_percent"],
                        "current_stock": r["current_stock"],
                        "units_sold_14d": r["units_sold"],
                        "suggested_action": r["suggested_action"],
                        "updated_at": now,
                    },
                },
            })
        else:
            sor_at_flag = r["sor_percent"]
            flagged_date = today_iso
            action_status = "pending"
            notes = ""
            to_insert.append({
                "style_name": r["style_name"],
                "brand": r["brand"],
                "subcategory": r["subcategory"],
                "category": r["category"],
                "flagged_date": today_iso,
                "sor_at_flag": sor_at_flag,
                "last_seen_sor": r["sor_percent"],
                "current_stock": r["current_stock"],
                "units_sold_14d": r["units_sold"],
                "suggested_action": r["suggested_action"],
                "action_status": "pending",
                "notes": "",
                "created_at": now,
                "updated_at": now,
                "last_seen_at": now,
            })

        sor_change = round(r["sor_percent"] - sor_at_flag, 2)
        days_since_flagged = (today - datetime.fromisoformat(flagged_date).date()).days
        status = _status_band(flagged_date, r["sor_percent"], sor_at_flag)
        outcome = (
            "improving" if sor_change >= 0.5
            else "declining" if sor_change <= -0.5
            else "stable"
        )
        enriched.append({
            **r,
            "flagged_date": flagged_date,
            "days_since_flagged": days_since_flagged,
            "sor_at_flag": sor_at_flag,
            "sor_change": sor_change,
            "status": status,
            "action_status": action_status,
            "notes": notes,
            "outcome": outcome,
            "needs_escalation": (days_since_flagged >= 7 and sor_change < 10),
        })

    if to_insert:
        try:
            await db[_COLL].insert_many(to_insert)
        except Exception as e:
            logger.warning("[marketing] insert_many failed: %s", e)
    for op in to_update_now:
        try:
            await db[_COLL].update_one(op["filter"], op["update"])
        except Exception as e:
            logger.debug("[marketing] update_one failed: %s", e)

    # Summary banner.
    total = len(enriched)
    stock_at_risk = round(sum(r["stock_value_at_risk"] for r in enriched), 2)
    avg_sor = round(sum(r["sor_percent"] for r in enriched) / total, 2) if total else 0.0
    critical = sum(1 for r in enriched if r["status"] == "Critical")
    improving = sum(1 for r in enriched if r["status"] == "Improving")

    return {
        "window": {"date_from": date_from, "date_to": date_to, "days": days},
        "threshold": threshold,
        "summary": {
            "total_slow_movers": total,
            "stock_value_at_risk_kes": stock_at_risk,
            "avg_sor_percent": avg_sor,
            "critical_count": critical,
            "improving_count": improving,
            "new_today": sum(1 for r in enriched if r["status"] == "New"),
        },
        "rows": enriched,
    }


# ─── Heatmap ────────────────────────────────────────────────────────
@api_router.get("/marketing/heatmap")
async def get_marketing_heatmap(
    days: int = 14,
    country: Optional[str] = None,
    channel: Optional[str] = None,
):
    today = datetime.now(timezone.utc).date()
    date_to = (today - timedelta(days=1)).isoformat()
    date_from = (today - timedelta(days=days)).isoformat()

    sales_rows = await _get_top_skus_live(
        date_from=date_from, date_to=date_to,
        country=country, channel=channel, brand=None, limit=10000,
    )
    inventory_rows = await fetch_all_inventory(
        country=country, location=None, product=None,
        locations=_split_csv(channel) if channel else None,
    )
    sales_rows = [r for r in (sales_rows or []) if not is_retired(r.get("style_name"))]
    inventory_rows = [r for r in (inventory_rows or []) if not is_retired(r.get("style_name") or r.get("product_name"))]

    grid = compute_heatmap(sales_rows, inventory_rows, categories=MERCH_CATEGORIES)
    grid["window"] = {"date_from": date_from, "date_to": date_to, "days": days}
    return grid


# ─── Flag tracker ───────────────────────────────────────────────────
@api_router.get("/marketing/flags")
async def list_flags(
    action_status: Optional[str] = None,
    limit: int = 5000,
):
    await _ensure_indexes()
    q: Dict[str, Any] = {}
    if action_status:
        q["action_status"] = action_status
    docs = []
    cursor = db[_COLL].find(q, {"_id": 0}).sort("flagged_date", -1).limit(int(limit))
    async for doc in cursor:
        docs.append(_flag_doc_for_response(doc))
    return {"count": len(docs), "rows": docs}


@api_router.patch("/marketing/flags/{style_name}")
async def update_flag(
    style_name: str,
    body: FlagUpdate,
    user: User = Depends(get_current_user),
):
    """Update the action_status and/or notes for a flag.  Auto-stamps
    updated_at + the user who edited it (audit trail)."""
    await _ensure_indexes()
    upd: Dict[str, Any] = {"updated_at": _today(), "updated_by": getattr(user, "email", None)}
    if body.action_status is not None:
        if body.action_status not in {"pending", "in_progress", "done"}:
            raise HTTPException(status_code=400, detail="action_status must be pending|in_progress|done")
        upd["action_status"] = body.action_status
    if body.notes is not None:
        upd["notes"] = body.notes[:2000]
    if len(upd) == 2:  # only the auto fields → no real update
        raise HTTPException(status_code=400, detail="Must provide action_status or notes")
    res = await db[_COLL].update_one({"style_name": style_name}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"No flag found for style: {style_name}")
    doc = await db[_COLL].find_one({"style_name": style_name}, {"_id": 0})
    return _flag_doc_for_response(doc or {})


class BulkFlagBody(BaseModel):
    style_names: List[str]
    action_status: str = "in_progress"


@api_router.post("/marketing/flags/bulk-status")
async def bulk_update_status(
    body: BulkFlagBody,
    user: User = Depends(get_current_user),
):
    """Used by the "Flag selected for campaign" button — flips the
    action_status for an array of styles in a single round-trip."""
    if body.action_status not in {"pending", "in_progress", "done"}:
        raise HTTPException(status_code=400, detail="action_status must be pending|in_progress|done")
    if not body.style_names:
        return {"updated": 0}
    res = await db[_COLL].update_many(
        {"style_name": {"$in": body.style_names}},
        {"$set": {
            "action_status": body.action_status,
            "updated_at": _today(),
            "updated_by": getattr(user, "email", None),
        }},
    )
    return {"updated": int(res.modified_count)}
