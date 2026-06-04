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

from fastapi import Depends, HTTPException
from pydantic import BaseModel

# Late import — server.py owns the api_router.
from server import api_router, logger, analytics_sor_all_styles, _hydrate_launch_dates_from_mongo  # type: ignore
from auth import db, get_current_user, User
from range_mgmt import (
    classify_all,
    summarise,
    retirement_pipeline,
    diff_movements,
    tier3_to_tier2_candidates,
)


_HIST_COLL = "style_tier_history"
_OVERRIDE_COLL = "style_tier_overrides"


async def _ensure_indexes() -> None:
    try:
        await db[_HIST_COLL].create_index([("style_name", 1), ("changed_at", -1)])
        await db[_HIST_COLL].create_index("changed_at")
        await db[_OVERRIDE_COLL].create_index("style_name", unique=True)
    except Exception as e:  # pragma: no cover
        logger.debug("[range-mgmt] index ensure: %s", e)


async def _load_overrides() -> Dict[str, dict]:
    """Returns {style_name: override_doc} for every active override."""
    out: Dict[str, dict] = {}
    async for doc in db[_OVERRIDE_COLL].find({}, {"_id": 0}):
        sn = doc.get("style_name")
        if sn:
            out[sn] = doc
    return out


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

    # Iter 89w-e — the sor-all-styles endpoint caps `style_age_weeks`
    # at 26 (180-day data window) for column-comparability reasons.
    # For the 4-tier framework we need the TRUE age so the Tier 2 /
    # Tier 1 buckets (which start at 36 / 96 weeks) can ever populate
    # and the "approaching 9-month gate" candidate panel can find
    # styles in the 30-36-week window.
    #
    # `style_launch_dates` collection persists `first_sale_iso` per
    # style across all past fan-outs, so it can shift launch dates
    # back-in-time as we observe older sales.  We layer that on top.
    style_names = [r.get("style_name") for r in (sor_rows or []) if r.get("style_name")]
    persisted = await _hydrate_launch_dates_from_mongo(style_names)
    today = datetime.now(timezone.utc).date()
    for r in (sor_rows or []):
        sn = r.get("style_name")
        first_iso = persisted.get(sn)
        if first_iso:
            try:
                pf = datetime.fromisoformat(first_iso).date()
                true_age_w = (today - pf).days / 7.0
                # Only OVERRIDE the capped age when our persisted date
                # gives us a STRICTLY-LARGER age (shrinking would be
                # wrong if the persisted record is stale/earlier).
                if true_age_w > (r.get("style_age_weeks") or 0):
                    r["style_age_weeks"] = round(true_age_w, 1)
            except Exception:
                pass

    classified = classify_all(sor_rows or [], include_retired=include_retired)

    # Iter 91u — physically-retired rows (style_status=="retired"
    # upstream) for the new "Retired" KPI card. Re-classify with
    # include_retired so we can isolate them; the auto-classifier's
    # "Retire" tier is a separate concept (auto-flag for retirement,
    # not yet actioned).
    retired_only: List[dict] = []
    for r in (sor_rows or []):
        if r.get("style_status") == "retired":
            retired_only.append(r)

    # Iter 89w-f — apply manual tier overrides (merch team can promote
    # styles to Tier 2 / demote / hold against the auto-classifier).
    overrides = await _load_overrides()
    for r in classified:
        ov = overrides.get(r["style_name"])
        if not ov:
            continue
        r["auto_tier"] = r["tier"]               # keep the auto label
        r["tier"] = ov.get("override_tier")
        r["override_reason"] = ov.get("reason")
        r["override_by"] = ov.get("set_by")
        r["override_at"] = (
            ov["set_at"].isoformat() if isinstance(ov.get("set_at"), datetime) else ov.get("set_at")
        )
        r["status"] = "On Track"                 # manual overrides are by definition "on track"
        r["recommended_action"] = f"Manual override active — {ov.get('reason') or 'no reason given'}"

    # Detect movements (vs the LATEST persisted tier per style) and
    # log them so the /movements endpoint can serve last-30-days
    # trends without re-classifying.
    prev_map = await _load_prev_tier_map()
    moves = diff_movements(classified, prev_map)
    await _record_movements(moves)

    summary = summarise(classified, retired_only)
    pipeline = retirement_pipeline(classified)
    candidates = tier3_to_tier2_candidates(classified)

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "rows": classified,
        "retired_rows": retired_only,  # Iter 91u — fuel the FE Retired card drill-down
        "retirement_pipeline": pipeline,
        "tier3_graduation_candidates": candidates,
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


# ─── Manual tier overrides ──────────────────────────────────────────
class BulkPromoteBody(BaseModel):
    style_names: List[str]
    override_tier: str = "Tier 2"
    reason: Optional[str] = None


@api_router.post("/range-mgmt/overrides/bulk-promote")
async def bulk_promote(body: BulkPromoteBody, user: User = Depends(get_current_user)):
    """Upsert tier overrides for a list of styles.  Used by the
    Range Mgmt "Promote N to Tier 2" button on the graduation
    candidates panel.

    `override_tier` must be one of Tier 1 / Tier 2 / Tier 3 / Tier 4 /
    Retire so we don't end up with garbage strings in the collection.
    """
    if body.override_tier not in {"Tier 1", "Tier 2", "Tier 3", "Tier 4", "Retire"}:
        raise HTTPException(status_code=400, detail="override_tier must be Tier 1 | Tier 2 | Tier 3 | Tier 4 | Retire")
    if not body.style_names:
        return {"upserted": 0}
    await _ensure_indexes()
    now = datetime.now(timezone.utc)
    set_by = getattr(user, "email", None)
    reason = (body.reason or f"Bulk-promoted to {body.override_tier}")[:500]
    n = 0
    for sn in body.style_names:
        res = await db[_OVERRIDE_COLL].update_one(
            {"style_name": sn},
            {"$set": {
                "style_name": sn,
                "override_tier": body.override_tier,
                "reason": reason,
                "set_by": set_by,
                "set_at": now,
            }},
            upsert=True,
        )
        if res.modified_count or res.upserted_id:
            n += 1
    return {"upserted": n}


@api_router.delete("/range-mgmt/overrides/{style_name}")
async def revert_override(style_name: str, user: User = Depends(get_current_user)):
    """Drop a manual override so the style returns to its auto tier."""
    res = await db[_OVERRIDE_COLL].delete_one({"style_name": style_name})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"No override for style: {style_name}")
    return {"deleted": True, "style_name": style_name}


@api_router.get("/range-mgmt/overrides")
async def list_overrides():
    """List every active manual override.  Used for the small
    "Manual overrides" panel on the page."""
    await _ensure_indexes()
    rows: List[dict] = []
    async for doc in db[_OVERRIDE_COLL].find({}, {"_id": 0}).sort("set_at", -1):
        sa = doc.get("set_at")
        if isinstance(sa, datetime):
            doc["set_at"] = sa.astimezone(timezone.utc).isoformat()
        rows.append(doc)
    return {"count": len(rows), "rows": rows}



# ───── Iter 91q — Weekly SOR for new styles (< 14 weeks old) ─────────────
@api_router.get("/range-mgmt/weekly-sor")
async def weekly_sor_new_styles(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    _u: User = Depends(get_current_user),
):
    """Cumulative weekly SOR per style aged < 14 weeks.

    Each row carries `sor_w1, sor_w2, ... sor_w14` where:
        sor_wN = units_sold_through_weekN / (units_sold_through_weekN + current_stock)

    Future weeks (i.e. weeks the style hasn't yet lived through) are `null`.
    Drives the "Weekly SOR heatmap" card on Range Mgmt.
    """
    import asyncio as _asyncio
    from datetime import date, timedelta
    # Server.py helpers — late imports to dodge circulars.
    from server import _split_csv, fetch, _net_returns  # type: ignore

    classify_payload = await analytics_sor_all_styles(
        country=country, channel=channel,
    )
    rows_in: List[dict] = classify_payload if isinstance(classify_payload, list) else (classify_payload or {}).get("rows") or []
    young = [
        r for r in rows_in
        if r.get("style_age_weeks") is not None
        and 0 <= float(r["style_age_weeks"]) < 14
        and r.get("launch_date")
    ]
    if not young:
        return {"weeks": list(range(1, 15)), "rows": []}

    # Per-style launch dates.
    style_launches: Dict[str, date] = {}
    for r in young:
        try:
            style_launches[r["style_name"]] = date.fromisoformat(r["launch_date"][:10])
        except (TypeError, ValueError):
            continue

    today = date.today()
    cs = _split_csv(country)
    chs = _split_csv(channel)

    async def _topskus_through(end_date: date) -> Dict[str, Dict[str, Any]]:
        earliest = min(style_launches.values())
        base = {
            "date_from": earliest.isoformat(),
            "date_to": end_date.isoformat(),
            "limit": 10000,
        }
        if len(cs) <= 1 and len(chs) <= 1:
            data = await fetch("/top-skus", {
                **base,
                "country": cs[0] if cs else None,
                "channel": chs[0] if chs else None,
            }) or []
            rows_out = list(data)
        else:
            res = await _asyncio.gather(*[
                fetch("/top-skus", {**base, "country": c, "channel": ch})
                for c in (cs or [None])
                for ch in (chs or [None])
            ])
            merged: Dict[str, Dict[str, Any]] = {}
            for g in res:
                for r in (g or []):
                    s = r.get("style_name")
                    if not s:
                        continue
                    if s not in merged:
                        merged[s] = {**r}
                    else:
                        for f in ("units_sold", "total_sales", "gross_sales"):
                            merged[s][f] = (merged[s].get(f) or 0) + (r.get(f) or 0)
            rows_out = list(merged.values())
        await _net_returns(
            rows_out,
            date_from=base["date_from"], date_to=base["date_to"],
            country=country, channel=channel, axis="style",
        )
        return {r.get("style_name"): r for r in rows_out if r.get("style_name")}

    weekly_endings: List[date] = []
    for w in range(1, 15):
        weekly_endings.append(today - timedelta(weeks=14 - w))
    weekly_endings = [min(d, today) for d in weekly_endings]

    weekly_snapshots = await _asyncio.gather(*[_topskus_through(d) for d in weekly_endings])

    out: List[Dict[str, Any]] = []
    for r in young:
        s = r["style_name"]
        launch = style_launches.get(s)
        if not launch:
            continue
        soh = float(r.get("soh_total") or 0)
        age_wks = float(r.get("style_age_weeks") or 0)
        weekly_sors: List[Optional[float]] = []
        for w in range(1, 15):
            week_end = launch + timedelta(weeks=w)
            if week_end > today:
                weekly_sors.append(None)
                continue
            idx = min(range(len(weekly_endings)), key=lambda i: abs((weekly_endings[i] - week_end).days))
            snap = weekly_snapshots[idx].get(s) or {}
            units_through = float(snap.get("units_sold") or 0)
            denom = units_through + soh
            sor = (units_through / denom * 100.0) if denom > 0 else 0.0
            weekly_sors.append(round(sor, 1))
        out.append({
            "style_name": s,
            "style_number": r.get("style_number"),
            "brand": r.get("brand"),
            "subcategory": r.get("subcategory"),
            "launch_date": r.get("launch_date"),
            "age_weeks": round(age_wks, 1),
            "current_stock": int(soh),
            "units_since_launch": int(r.get("units_since_launch") or 0),
            "sor_lifetime": r.get("sor_since_launch"),
            "weekly_sor": weekly_sors,
        })
    out.sort(key=lambda r: (r["age_weeks"], r["style_name"]))
    return {"weeks": list(range(1, 15)), "rows": out}


# ───── Iter 91q — Marketing Action Tracker ───────────────────────────────
_MA_COLL = "marketing_actions"
ALLOWED_ACTION_TYPES = [
    "Homepage Banner",
    "Social Media Ad",
    "Influencer Post",
    "Email Campaign",
    "Discount",
    "Restaging in Store",
    "Other",
]


async def _ensure_ma_indexes() -> None:
    try:
        await db[_MA_COLL].create_index([("style_number", 1), ("started_at", -1)])
        await db[_MA_COLL].create_index([("started_at", -1)])
    except Exception:
        pass


class MarketingActionIn(BaseModel):
    style_number: str
    style_name: Optional[str] = None
    action_type: str
    notes: Optional[str] = None
    discount_pct: Optional[float] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


@api_router.post("/range-mgmt/marketing-actions")
async def log_marketing_action(
    body: MarketingActionIn,
    u: User = Depends(get_current_user),
):
    await _ensure_ma_indexes()
    if body.action_type not in ALLOWED_ACTION_TYPES:
        raise HTTPException(400, f"action_type must be one of {ALLOWED_ACTION_TYPES}")
    started = body.started_at or datetime.now(timezone.utc).date().isoformat()
    style_snapshot: Dict[str, Any] = {}
    try:
        rows = await analytics_sor_all_styles()
        rows = rows if isinstance(rows, list) else (rows or {}).get("rows") or []
        for r in rows:
            if (r.get("style_number") or "").upper() == body.style_number.upper():
                style_snapshot = {
                    "sor_lifetime_at_start": r.get("sor_since_launch"),
                    "sor_6m_at_start": r.get("sor_6m"),
                    "units_at_start": r.get("units_since_launch"),
                    "stock_at_start": r.get("soh_total"),
                    "style_age_weeks_at_start": r.get("style_age_weeks"),
                }
                if not body.style_name:
                    body.style_name = r.get("style_name")
                break
    except Exception as e:
        logger.warning("[marketing-action] snapshot lookup failed: %s", e)

    doc = {
        "style_number": body.style_number.upper(),
        "style_name": body.style_name,
        "action_type": body.action_type,
        "discount_pct": body.discount_pct,
        "notes": body.notes,
        "started_at": started,
        "ended_at": body.ended_at,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": u.email,
        **style_snapshot,
    }
    res = await db[_MA_COLL].insert_one(doc)
    return {"ok": True, "id": str(res.inserted_id),
            "action": {k: v for k, v in doc.items() if k != "_id"}}


@api_router.get("/range-mgmt/marketing-actions")
async def list_marketing_actions(
    style_number: Optional[str] = None,
    _u: User = Depends(get_current_user),
):
    await _ensure_ma_indexes()
    q: Dict[str, Any] = {}
    if style_number:
        q["style_number"] = style_number.upper()
    rows: List[dict] = []
    async for doc in db[_MA_COLL].find(q).sort("started_at", -1):
        # Convert ObjectId → string so the FE can issue DELETE by id.
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        rows.append(doc)
    # Enrich with CURRENT SOR so the FE can compute delta_sor.
    if rows:
        try:
            current = await analytics_sor_all_styles()
            current = current if isinstance(current, list) else (current or {}).get("rows") or []
            curr_by_sn: Dict[str, Dict[str, Any]] = {}
            for r in current:
                sn = (r.get("style_number") or "").upper()
                if sn:
                    curr_by_sn[sn] = r
            for r in rows:
                sn = (r.get("style_number") or "").upper()
                live = curr_by_sn.get(sn) or {}
                r["sor_lifetime_now"] = live.get("sor_since_launch")
                r["sor_6m_now"] = live.get("sor_6m")
                r["units_now"] = live.get("units_since_launch")
                r["stock_now"] = live.get("soh_total")
                if r.get("sor_lifetime_at_start") is not None and live.get("sor_since_launch") is not None:
                    r["sor_delta"] = round(
                        float(live["sor_since_launch"]) - float(r["sor_lifetime_at_start"]),
                        1,
                    )
        except Exception as e:
            logger.warning("[marketing-actions] enrich failed: %s", e)
    return {"count": len(rows), "rows": rows}


@api_router.delete("/range-mgmt/marketing-actions/{action_id}")
async def delete_marketing_action(
    action_id: str,
    _u: User = Depends(get_current_user),
):
    from bson import ObjectId  # type: ignore
    try:
        oid = ObjectId(action_id)
    except Exception:
        raise HTTPException(400, "Invalid action_id")
    res = await db[_MA_COLL].delete_one({"_id": oid})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.get("/range-mgmt/marketing-candidates")
async def marketing_action_candidates(
    country: Optional[str] = None,
    channel: Optional[str] = None,
    sor_threshold: float = 40.0,
    age_min_weeks: float = 4.0,
    _u: User = Depends(get_current_user),
):
    """Styles ≥ `age_min_weeks` old with `sor_since_launch < sor_threshold`.
    Excludes styles that already have an action logged in the last 14
    days — those are 'in flight' and rendered separately."""
    await _ensure_ma_indexes()
    payload = await analytics_sor_all_styles(country=country, channel=channel)
    rows = payload if isinstance(payload, list) else (payload or {}).get("rows") or []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).date().isoformat()
    recent: set = set()
    async for d in db[_MA_COLL].find(
        {"started_at": {"$gte": cutoff}},
        {"style_number": 1, "_id": 0},
    ):
        sn = (d.get("style_number") or "").upper()
        if sn:
            recent.add(sn)
    candidates: List[dict] = []
    in_flight: List[dict] = []
    for r in rows:
        age = r.get("style_age_weeks")
        sor = r.get("sor_since_launch")
        if age is None or sor is None:
            continue
        if age < age_min_weeks:
            continue
        if sor >= sor_threshold:
            continue
        sn = (r.get("style_number") or "").upper()
        bucket = {
            "style_name": r.get("style_name"),
            "style_number": r.get("style_number"),
            "brand": r.get("brand"),
            "subcategory": r.get("subcategory"),
            "launch_date": r.get("launch_date"),
            "age_weeks": round(float(age), 1),
            "sor_lifetime": sor,
            "units_since_launch": r.get("units_since_launch"),
            "current_stock": r.get("soh_total"),
            "days_since_last_sale": r.get("days_since_last_sale"),
        }
        if sn in recent:
            in_flight.append(bucket)
        else:
            candidates.append(bucket)
    candidates.sort(key=lambda x: (x["sor_lifetime"] or 0))
    in_flight.sort(key=lambda x: (x["sor_lifetime"] or 0))
    return {
        "threshold_pct": sor_threshold,
        "age_min_weeks": age_min_weeks,
        "candidates_count": len(candidates),
        "in_flight_count": len(in_flight),
        "action_types": ALLOWED_ACTION_TYPES,
        "candidates": candidates,
        "in_flight": in_flight,
    }
