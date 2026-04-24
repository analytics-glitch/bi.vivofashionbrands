"""
Notifications bell — curated platform events.

Audit #15: give users a single dopamine-friendly inbox for the events
that matter enough to interrupt (new records, stockouts, VIP customer
returns, counter anomalies). Runs on-demand: the frontend pings
`/refresh` on bell-open, which synthesises notifications from the same
live sources the dashboards use, idempotently upserting into Mongo so
the same event isn't duplicated.

Collections
-----------
- `notifications` — one doc per canonical event
    {
        _id:        ObjectId,
        event_id:   str,    # stable id: "type::scope::period" (idempotent)
        type:       "new_record" | "stockout" | "vip_return" | "anomaly",
        severity:   "info" | "warn" | "celebrate",
        title:      str,
        message:    str,
        link:       str,    # in-app route
        metadata:   dict,   # type-specific payload
        created_at: datetime,
    }
- `notification_reads` — per-user read state
    {
        user_id:          str,
        event_id:         str,
        read_at:          datetime,
    }

Reads are per-user. Events are global (everyone sees the same inbox);
read-state is personal.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import db, get_current_user, User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

MAX_AGE_DAYS = 14  # keep inbox from growing unboundedly
MAX_EVENTS_PER_REFRESH = 40  # per-type cap


# ─── models ───────────────────────────────────────────────────────────

class NotificationRow(BaseModel):
    event_id: str
    type: str
    severity: str
    title: str
    message: str
    link: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: Optional[datetime] = None
    read: bool = False


# ─── indexes ─────────────────────────────────────────────────────────

async def _ensure_indexes() -> None:
    try:
        await db.notifications.create_index("event_id", unique=True, background=True)
        await db.notifications.create_index([("created_at", -1)], background=True)
        await db.notification_reads.create_index(
            [("user_id", 1), ("event_id", 1)], unique=True, background=True,
        )
    except Exception:
        pass


# ─── refresh (event synthesis) ───────────────────────────────────────

def _today_period() -> str:
    return datetime.now(timezone.utc).date().isoformat()


async def _synthesise_new_records() -> List[Dict[str, Any]]:
    """Pull 'new_record' events from the store-of-the-week recap."""
    try:
        from leaderboard import get_store_of_the_week
        sotw = await get_store_of_the_week()
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    for row in (sotw or {}).get("days", []) or []:
        if not row.get("new_record"):
            continue
        day = row.get("date") or _today_period()
        event_id = f"new_record::{row.get('pos_location') or 'unknown'}::{day}"
        out.append({
            "event_id": event_id,
            "type": "new_record",
            "severity": "celebrate",
            "title": "🏆 NEW RECORD",
            "message": f"{row.get('pos_location','Store')} posted KES {int(row.get('total_sales') or 0):,} on {day} — new all-time daily high.",
            "link": "/locations",
            "metadata": row,
        })
    return out[:MAX_EVENTS_PER_REFRESH]


async def _synthesise_stockouts() -> List[Dict[str, Any]]:
    """Styles with weeks-of-cover < 1 = will stock out within 7 days."""
    try:
        from server import fetch, multi_fetch, _split_csv  # late import: server.py is the aggregator
    except Exception:
        return []
    from datetime import datetime as _dt, timedelta as _td
    dt = _dt.utcnow().date()
    df = dt - _td(days=28)
    base = {"date_from": df.isoformat(), "date_to": dt.isoformat()}
    try:
        rows = await fetch("/sor", {**base})
    except Exception:
        return []
    period = _today_period()
    out: List[Dict[str, Any]] = []
    for r in rows or []:
        units = r.get("units_sold") or 0
        stock = r.get("current_stock") or 0
        if units <= 0:
            continue
        weekly = units / 4
        woh = stock / weekly if weekly else None
        if woh is None or woh >= 1:
            continue
        style = r.get("style_name") or "Style"
        event_id = f"stockout::{style}::{period}"
        out.append({
            "event_id": event_id,
            "type": "stockout",
            "severity": "warn",
            "title": "⚠️ Stockout imminent",
            "message": f"{style} has {woh:.1f}w of cover ({stock} units, {int(weekly)}/w velocity) — reorder before it zeros out.",
            "link": "/re-order",
            "metadata": {"style": style, "stock": stock, "weekly_velocity": weekly, "woh": woh},
        })
        if len(out) >= MAX_EVENTS_PER_REFRESH:
            break
    return out


async def _synthesise_anomalies() -> List[Dict[str, Any]]:
    """Counter anomalies = conversion outliers + return-rate spikes. Pulls
    the same data the Data Quality page uses, without re-doing the stats
    (we flag the obvious cases — ≥50% CR, ≥30% return rate)."""
    try:
        from server import fetch
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    period = _today_period()
    # Footfall — CR ≥ 50% is implausible; raise it.
    try:
        ff = await fetch("/footfall", {})
    except Exception:
        ff = []
    for r in ff or []:
        cr = r.get("conversion_rate")
        if cr is None or cr < 50:
            continue
        loc = r.get("pos_location") or "Store"
        event_id = f"anomaly::cr::{loc}::{period}"
        out.append({
            "event_id": event_id,
            "type": "anomaly",
            "severity": "warn",
            "title": "🚨 Counter anomaly",
            "message": f"{loc} reporting {cr:.1f}% conversion rate — check door counters, duplicate entries, or daypart misalignment.",
            "link": "/data-quality",
            "metadata": {"metric": "conversion_rate", "location": loc, "value": cr},
        })
        if len(out) >= MAX_EVENTS_PER_REFRESH // 2:
            break
    # Sales summary — flag return-rate ≥ 30% at location level.
    try:
        ss = await fetch("/sales-summary", {})
    except Exception:
        ss = []
    for r in ss or []:
        sales = r.get("net_sales") or 0
        returns = r.get("returns") or 0
        if sales <= 0:
            continue
        rr = (abs(returns) / sales) * 100
        if rr < 30:
            continue
        loc = r.get("pos_location") or r.get("channel") or "Channel"
        event_id = f"anomaly::rr::{loc}::{period}"
        out.append({
            "event_id": event_id,
            "type": "anomaly",
            "severity": "warn",
            "title": "🚨 Counter anomaly",
            "message": f"{loc} return rate at {rr:.1f}% — audit suspected returns-abuse or wrong-SKU refunds.",
            "link": "/data-quality",
            "metadata": {"metric": "return_rate", "location": loc, "value": rr},
        })
        if len(out) >= MAX_EVENTS_PER_REFRESH:
            break
    return out


async def _synthesise_vip_returns() -> List[Dict[str, Any]]:
    """VIP customer returning after 30+ days absent. Uses upstream
    /top-customers + /customer-frequency. Conservative: only top-20
    spenders."""
    try:
        from server import fetch
    except Exception:
        return []
    try:
        top = await fetch("/top-customers", {"limit": 20})
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    period = _today_period()
    for c in (top or [])[:20]:
        cid = c.get("customer_id") or c.get("partner_id")
        if not cid:
            continue
        try:
            freq = await fetch("/customer-frequency", {"customer_id": cid})
        except Exception:
            continue
        last = (freq or {}).get("last_purchase_date")
        if not last:
            continue
        try:
            last_dt = datetime.fromisoformat(str(last)[:10])
        except Exception:
            continue
        days = (datetime.utcnow() - last_dt).days
        if days < 30 or days > 90:
            continue
        name = c.get("customer_name") or c.get("name") or f"Customer {cid}"
        event_id = f"vip_return::{cid}::{period}"
        out.append({
            "event_id": event_id,
            "type": "vip_return",
            "severity": "info",
            "title": "💎 VIP returning",
            "message": f"{name} is back after {days} days (KES {int(c.get('total_spend') or 0):,} lifetime). Send a welcome-back SMS.",
            "link": "/customers",
            "metadata": {"customer_id": cid, "days_absent": days},
        })
        if len(out) >= 10:
            break
    return out


@router.post("/refresh")
async def refresh_notifications(_: User = Depends(get_current_user)):
    """Synthesise the 4 event families and upsert them. Safe to call
    repeatedly — event_id is deterministic so dupes collapse."""
    await _ensure_indexes()
    synths = await asyncio.gather(
        _synthesise_new_records(),
        _synthesise_stockouts(),
        _synthesise_anomalies(),
        _synthesise_vip_returns(),
        return_exceptions=True,
    )
    events: List[Dict[str, Any]] = []
    for s in synths:
        if isinstance(s, list):
            events.extend(s)
    now = datetime.now(timezone.utc)
    upserted = 0
    for e in events:
        res = await db.notifications.update_one(
            {"event_id": e["event_id"]},
            {"$set": {**e, "created_at": now}, "$setOnInsert": {}},
            upsert=True,
        )
        if res.upserted_id or res.modified_count:
            upserted += 1
    # Prune events older than MAX_AGE_DAYS to keep inbox focused.
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    await db.notifications.delete_many({"created_at": {"$lt": cutoff}})
    return {"generated": len(events), "upserted": upserted}


# ─── reads / list ─────────────────────────────────────────────────────

@router.get("", response_model=List[NotificationRow])
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    only_unread: bool = Query(False),
    user: User = Depends(get_current_user),
):
    await _ensure_indexes()
    # All reads this user has already acked.
    read_ids: set = set()
    async for r in db.notification_reads.find(
        {"user_id": user.user_id},
        {"_id": 0, "event_id": 1},
    ):
        read_ids.add(r["event_id"])
    cursor = db.notifications.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).limit(limit)
    out: List[NotificationRow] = []
    async for doc in cursor:
        read = doc["event_id"] in read_ids
        if only_unread and read:
            continue
        doc["read"] = read
        out.append(NotificationRow(**doc))
    return out


@router.get("/unread-count")
async def unread_count(user: User = Depends(get_current_user)):
    await _ensure_indexes()
    read_ids: set = set()
    async for r in db.notification_reads.find(
        {"user_id": user.user_id}, {"_id": 0, "event_id": 1},
    ):
        read_ids.add(r["event_id"])
    total = 0
    async for doc in db.notifications.find({}, {"_id": 0, "event_id": 1}):
        if doc["event_id"] not in read_ids:
            total += 1
    return {"unread": total}


@router.post("/{event_id}/read")
async def mark_read(
    event_id: str,
    user: User = Depends(get_current_user),
):
    await _ensure_indexes()
    exists = await db.notifications.find_one({"event_id": event_id}, {"_id": 0, "event_id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.notification_reads.update_one(
        {"user_id": user.user_id, "event_id": event_id},
        {"$set": {"user_id": user.user_id, "event_id": event_id, "read_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(user: User = Depends(get_current_user)):
    await _ensure_indexes()
    now = datetime.now(timezone.utc)
    count = 0
    async for doc in db.notifications.find({}, {"_id": 0, "event_id": 1}):
        await db.notification_reads.update_one(
            {"user_id": user.user_id, "event_id": doc["event_id"]},
            {"$set": {"user_id": user.user_id, "event_id": doc["event_id"], "read_at": now}},
            upsert=True,
        )
        count += 1
    return {"marked": count}
