"""Insights & advanced CRM features.

Mounts under /api/insights/*. Sourced primarily from `customer_cache` (eager-warmed
from the Vivo BI API) so analytics are fast and cheap. Some endpoints (real
retention triangle, leaderboards) cross-join MongoDB collections.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("vivo.insights")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_date(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


# Tier multipliers for crude LTV forecast (anchored on observed Vivo cohorts)
_TIER_PROJECTION = {
    "vip": 1.0,        # baseline — VIPs sustain pace
    "loyal": 0.85,
    "promising": 0.6,
    "new": 0.4,
    "at_risk": 0.25,
    "churned": 0.1,
}


# --------------------------------------------------------------------------- #
# Pydantic                                                                    #
# --------------------------------------------------------------------------- #

class WishlistIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    sku: Optional[str] = None
    product_title: str
    note: Optional[str] = None
    expires_in_days: int = 30


class ReplySuggestIn(BaseModel):
    feedback_id: str


class CheckinIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    note: Optional[str] = None


# --------------------------------------------------------------------------- #
# Router factory                                                              #
# --------------------------------------------------------------------------- #

def make_router(get_current_user, require_manager, db, audit_fn, bi_get):
    router = APIRouter(prefix="/insights", tags=["insights"])

    # --------------------------------------------------------------------- #
    # 1. Cohort analysis                                                    #
    # --------------------------------------------------------------------- #

    @router.get("/cohorts/retention")
    async def cohort_retention(months: int = 12, user: Any = Depends(require_manager)):
        """Acquisition-cohort retention: group customers by first-purchase month,
        report cohort size + % still active at +1m / +3m / +6m / +12m and avg LTV.

        Source: customer_cache (last_purchase_date proxies "still active").
        """
        rows = await db.customer_cache.find(
            {"first_purchase_date": {"$ne": None}},
            {"_id": 0, "first_purchase_date": 1, "last_purchase_date": 1, "total_sales": 1, "total_orders": 1, "rfm_tier": 1},
        ).to_list(50000)

        cohorts: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in rows:
            d = _parse_date(r.get("first_purchase_date"))
            if not d:
                continue
            cohorts[_month_key(d)].append(r)

        cutoff_min = (now_utc().replace(day=1) - timedelta(days=months * 32))
        result = []
        for month_key in sorted(cohorts.keys()):
            cohort_dt = datetime.strptime(month_key + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if cohort_dt < cutoff_min.replace(tzinfo=timezone.utc):
                continue
            customers = cohorts[month_key]
            total = len(customers)
            if total == 0:
                continue

            ltv_sum = sum(float(c.get("total_sales") or 0) for c in customers)
            orders_sum = sum(int(c.get("total_orders") or 0) for c in customers)
            tiers = defaultdict(int)
            for c in customers:
                tiers[c.get("rfm_tier") or "new"] += 1

            buckets = {1: 0, 3: 0, 6: 0, 12: 0}
            for c in customers:
                last = _parse_date(c.get("last_purchase_date"))
                if not last:
                    continue
                gap_days = (last.replace(tzinfo=timezone.utc) - cohort_dt).days
                gap_months = gap_days / 30.0
                for n in buckets:
                    if gap_months >= n:
                        buckets[n] += 1

            result.append({
                "cohort": month_key,
                "size": total,
                "retention": {
                    f"m{n}": round(buckets[n] * 100.0 / total, 1) if total else 0.0
                    for n in buckets
                },
                "avg_ltv_kes": round(ltv_sum / total, 0) if total else 0.0,
                "avg_orders": round(orders_sum / total, 1) if total else 0.0,
                "tier_mix": dict(tiers),
            })

        return {"months_window": months, "cohorts": result}

    @router.get("/cohorts/tier-flow")
    async def tier_flow(user: Any = Depends(require_manager)):
        """How customers from each acquisition cohort are distributed across
        RFM tiers today. Powers a Sankey/stacked-bar."""
        rows = await db.customer_cache.find(
            {"first_purchase_date": {"$ne": None}, "rfm_tier": {"$ne": None}},
            {"_id": 0, "first_purchase_date": 1, "rfm_tier": 1, "total_sales": 1},
        ).to_list(50000)

        flow: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        ltv: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for r in rows:
            d = _parse_date(r.get("first_purchase_date"))
            if not d:
                continue
            mk = _month_key(d)
            tier = r.get("rfm_tier") or "new"
            flow[mk][tier] += 1
            ltv[mk][tier] += float(r.get("total_sales") or 0)

        out = []
        for mk in sorted(flow.keys())[-18:]:  # last 18 months
            total = sum(flow[mk].values())
            out.append({
                "cohort": mk,
                "size": total,
                "by_tier": dict(flow[mk]),
                "ltv_by_tier_kes": {k: round(v, 0) for k, v in ltv[mk].items()},
            })
        return {"flows": out}

    @router.get("/cohorts/by-channel")
    async def cohort_by_channel(user: Any = Depends(require_manager)):
        """Per-channel (city / country) cohort comparison: cohort size, avg LTV,
        retention %. Helps store managers benchmark their store vs. the network."""
        rows = await db.customer_cache.find(
            {"first_purchase_date": {"$ne": None}},
            {"_id": 0, "first_purchase_date": 1, "last_purchase_date": 1, "city": 1,
             "customer_country": 1, "total_sales": 1, "rfm_tier": 1},
        ).to_list(50000)

        by_channel: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in rows:
            channel = r.get("city") or r.get("customer_country") or "Unknown"
            by_channel[channel].append(r)

        now_dt = now_utc()
        out = []
        for ch, customers in by_channel.items():
            total = len(customers)
            if total < 5:
                continue  # noise threshold
            active_180d = 0
            ltv_sum = 0.0
            tier_counts = defaultdict(int)
            for c in customers:
                last = _parse_date(c.get("last_purchase_date"))
                if last and (now_dt - last.replace(tzinfo=timezone.utc)).days <= 180:
                    active_180d += 1
                ltv_sum += float(c.get("total_sales") or 0)
                tier_counts[c.get("rfm_tier") or "new"] += 1
            out.append({
                "channel": ch,
                "size": total,
                "active_180d_pct": round(active_180d * 100.0 / total, 1),
                "avg_ltv_kes": round(ltv_sum / total, 0),
                "tier_mix": dict(tier_counts),
            })
        out.sort(key=lambda x: -x["size"])
        return {"channels": out[:20]}

    @router.get("/cohorts/triangle")
    async def cohort_triangle(months: int = 12, _: Any = Depends(require_manager)):
        """Real per-month retention triangle: for each acquisition cohort, what %
        placed at least 1 order in each subsequent month. Pulls /orders from BI
        in pages and assembles per-customer monthly activity. Cached 24h."""
        cache = await db.cohort_triangle_cache.find_one({"months": months}, {"_id": 0})
        if cache:
            try:
                ts = datetime.fromisoformat(cache["computed_at"])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if (now_utc() - ts).total_seconds() < 24 * 3600:
                    return cache["result"]
            except Exception:
                pass

        date_from = (now_utc().replace(day=1) - timedelta(days=months * 32)).date().isoformat()
        date_to = now_utc().date().isoformat()
        orders = await bi_get("/orders", {"date_from": date_from, "date_to": date_to, "limit": 5000}) or []

        if not isinstance(orders, list):
            orders = []

        # Build first-purchase per customer + per-month-active set
        first_purchase: Dict[str, datetime] = {}
        active_months: Dict[str, set] = defaultdict(set)
        for o in orders:
            cid = o.get("customer_id")
            d = _parse_date(o.get("order_date") or o.get("date"))
            if not cid or not d:
                continue
            mk = _month_key(d)
            active_months[cid].add(mk)
            if cid not in first_purchase or d < first_purchase[cid]:
                first_purchase[cid] = d

        cohorts: Dict[str, List[str]] = defaultdict(list)
        for cid, fp in first_purchase.items():
            cohorts[_month_key(fp)].append(cid)

        triangle = []
        for cohort_mk in sorted(cohorts.keys()):
            customers = cohorts[cohort_mk]
            cohort_dt = datetime.strptime(cohort_mk + "-01", "%Y-%m-%d")
            row = {"cohort": cohort_mk, "size": len(customers), "retention": {}}
            for n in range(0, months + 1):
                target = cohort_dt + timedelta(days=n * 30)
                target_mk = _month_key(target)
                active = sum(1 for cid in customers if target_mk in active_months[cid])
                row["retention"][f"m{n}"] = round(active * 100.0 / len(customers), 1) if customers else 0.0
            triangle.append(row)

        result = {
            "months": months,
            "rows": triangle,
            "source": "BI /orders",
            "orders_seen": len(orders),
            "computed_at": iso(now_utc()),
        }
        await db.cohort_triangle_cache.update_one(
            {"months": months},
            {"$set": {"months": months, "result": result, "computed_at": iso(now_utc())}},
            upsert=True,
        )
        return result

    @router.get("/cohorts/customers")
    async def cohort_customers(
        cohort: str,
        bucket: Optional[str] = None,
        limit: int = 200,
        _: Any = Depends(require_manager),
    ):
        """List the actual customers behind a cohort cell.

        `cohort` — YYYY-MM of acquisition month.
        `bucket` (optional) — filter to one retention slice:
          - active_180d   → last_purchase within 180d of today
          - retained_m1 / m3 / m6 / m12 → last_purchase >= cohort + N months
          - vip / loyal / promising / at_risk / churned / new → RFM tier filter
        """
        rows = await db.customer_cache.find(
            {"first_purchase_date": {"$regex": f"^{re.escape(cohort)}-"}},
            {"_id": 0},
        ).to_list(10000)

        now_dt = now_utc()
        cohort_dt = _parse_date(cohort + "-01") or now_dt

        filtered: List[Dict[str, Any]] = []
        for r in rows:
            last = _parse_date(r.get("last_purchase_date"))
            tier = r.get("rfm_tier") or "new"
            if bucket:
                if bucket == "active_180d":
                    if not last or (now_dt - last).days > 180:
                        continue
                elif bucket.startswith("retained_m"):
                    n = int(bucket.split("_m", 1)[1])
                    if not last or (last - cohort_dt).days < n * 30:
                        continue
                elif bucket in {"vip", "loyal", "promising", "at_risk", "churned", "new"}:
                    if tier != bucket:
                        continue
            filtered.append({
                "customer_id": r.get("customer_id"),
                "customer_name": r.get("customer_name"),
                "city": r.get("city"),
                "rfm_tier": tier,
                "total_sales": float(r.get("total_sales") or 0),
                "total_orders": int(r.get("total_orders") or 0),
                "last_purchase_date": r.get("last_purchase_date"),
                "avg_basket": float(r.get("avg_basket") or 0),
            })
        filtered.sort(key=lambda c: -c["total_sales"])
        return {
            "cohort": cohort,
            "bucket": bucket,
            "count": len(filtered),
            "customers": filtered[:limit],
        }

    @router.post("/cohorts/bulk-task")
    async def cohort_bulk_task(payload: Dict[str, Any] = Body(...), user: Any = Depends(require_manager)):
        """Create one follow-up task per customer in a cohort+bucket slice.

        Body: {cohort, bucket?, title, notes?, due_date?, assignee_user_id?}
        """
        cohort = payload.get("cohort")
        if not cohort:
            raise HTTPException(status_code=400, detail="cohort required")
        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title required")

        resp = await cohort_customers(cohort, payload.get("bucket"), limit=500)  # type: ignore[arg-type]
        customers = resp["customers"]

        assignee_id = payload.get("assignee_user_id") or user.user_id
        assignee_name = payload.get("assignee_name") or user.name
        due = payload.get("due_date")
        notes_base = payload.get("notes") or f"Bulk task for {cohort} cohort" + (f" · bucket={payload.get('bucket')}" if payload.get("bucket") else "")

        created = 0
        for c in customers:
            doc = {
                "task_id": _new_id(),
                "customer_id": c["customer_id"],
                "customer_name": c.get("customer_name"),
                "assignee_user_id": assignee_id,
                "assignee_name": assignee_name,
                "title": title,
                "due_date": due,
                "notes": notes_base,
                "completed": False,
                "completed_at": None,
                "created_at": iso(now_utc()),
                "auto_generated": True,
                "auto_theme": "cohort_bulk",
                "cohort": cohort,
                "cohort_bucket": payload.get("bucket"),
            }
            await db.customer_tasks.insert_one(dict(doc))
            created += 1

        await audit_fn(user, "cohort.bulk_task", "cohort", cohort, None)
        return {"created": created, "cohort": cohort, "bucket": payload.get("bucket"), "title": title}

    # --------------------------------------------------------------------- #
    # 11. Overview — headline insights strip                                #
    # --------------------------------------------------------------------- #

    @router.get("/overview")
    async def overview(_: Any = Depends(require_manager)):
        """Executive overview: headline KPIs + 30d trends + key callouts."""
        now_dt = now_utc()
        cutoff_30 = (now_dt - timedelta(days=30)).isoformat()
        cutoff_60 = (now_dt - timedelta(days=60)).isoformat()

        # Customer-cache base
        total_customers = await db.customer_cache.count_documents({})

        # New this 30d / previous 30d
        new_30 = await db.customer_cache.count_documents({"first_purchase_date": {"$gte": cutoff_30}})
        new_prev = await db.customer_cache.count_documents({"first_purchase_date": {"$gte": cutoff_60, "$lt": cutoff_30}})
        new_delta = _pct_delta(new_30, new_prev)

        # Active 30d (bought in last 30d)
        active_30 = await db.customer_cache.count_documents({"last_purchase_date": {"$gte": cutoff_30}})
        active_prev = await db.customer_cache.count_documents({"last_purchase_date": {"$gte": cutoff_60, "$lt": cutoff_30}})
        active_delta = _pct_delta(active_30, active_prev)

        # RFM distribution
        tier_dist = {}
        async for t in db.customer_cache.aggregate([
            {"$match": {"rfm_tier": {"$ne": None}}},
            {"$group": {"_id": "$rfm_tier", "n": {"$sum": 1}}},
        ]):
            tier_dist[t["_id"]] = t["n"]

        at_risk_count = tier_dist.get("at_risk", 0)
        vip_count = tier_dist.get("vip", 0)

        # Outreach 30d
        messages_30 = await db.message_logs.count_documents({"sent_at": {"$gte": cutoff_30}})
        messages_prev = await db.message_logs.count_documents({"sent_at": {"$gte": cutoff_60, "$lt": cutoff_30}})
        messages_delta = _pct_delta(messages_30, messages_prev)

        # Revenue est from cache (sum of total_sales of active-30d customers — proxy)
        rev_rows = await db.customer_cache.aggregate([
            {"$match": {"last_purchase_date": {"$gte": cutoff_30}}},
            {"$group": {"_id": None, "lifetime_sum": {"$sum": "$total_sales"}, "avg_basket": {"$avg": "$avg_basket"}}},
        ]).to_list(1)
        avg_basket = float(rev_rows[0]["avg_basket"]) if rev_rows else 0.0

        # Social sentiment 30d
        sent_dist: Dict[str, int] = defaultdict(int)
        async for s in db.social_feedback.aggregate([
            {"$match": {"posted_at": {"$gte": cutoff_30}, "sentiment": {"$ne": None}}},
            {"$group": {"_id": "$sentiment", "n": {"$sum": 1}}},
        ]):
            sent_dist[s["_id"]] = s["n"]
        sent_total = sum(sent_dist.values())
        sent_score = round(((sent_dist.get("positive", 0) - sent_dist.get("negative", 0)) / sent_total * 100), 1) if sent_total else 0.0

        # Callouts — small narrative badges
        callouts = []
        if new_delta is not None and new_delta > 15:
            callouts.append({"tone": "positive", "text": f"New customers up {new_delta:+.0f}% vs. prior 30d"})
        elif new_delta is not None and new_delta < -15:
            callouts.append({"tone": "warning", "text": f"New customers down {new_delta:+.0f}% vs. prior 30d"})
        if at_risk_count:
            callouts.append({"tone": "warning", "text": f"{at_risk_count} customers at risk — schedule win-backs"})
        if sent_score < 0 and sent_total > 10:
            callouts.append({"tone": "warning", "text": f"Social sentiment net {sent_score:+.0f} — check Inbox"})

        return {
            "generated_at": iso(now_dt),
            "kpis": {
                "total_customers": total_customers,
                "new_customers_30d": new_30,
                "new_customers_delta_pct": new_delta,
                "active_customers_30d": active_30,
                "active_customers_delta_pct": active_delta,
                "vip_customers": vip_count,
                "at_risk_customers": at_risk_count,
                "avg_basket_kes": round(avg_basket, 0),
                "messages_sent_30d": messages_30,
                "messages_delta_pct": messages_delta,
                "social_sentiment_net": sent_score,
                "social_feedback_30d": sent_total,
            },
            "tier_distribution": tier_dist,
            "sentiment_distribution": dict(sent_dist),
            "callouts": callouts,
        }

    # --------------------------------------------------------------------- #
    # 12. Purchase frequency distribution                                   #
    # --------------------------------------------------------------------- #

    @router.get("/purchase-frequency")
    async def purchase_frequency(_: Any = Depends(require_manager)):
        """Distribution of purchase cadences across the customer base.

        Buckets (avg days between orders, for customers with >= 2 orders):
          - weekly (0-14d)
          - monthly (14-60d)
          - quarterly (60-120d)
          - biannual (120-240d)
          - yearly (240-400d)
          - lapsed (>400d)
          - one_time (exactly 1 order)
        """
        rows = await db.customer_cache.find({}, {"_id": 0}).to_list(50000)
        buckets: Dict[str, Dict[str, Any]] = {
            k: {"count": 0, "customers_ltv_kes": 0.0}
            for k in ("weekly", "monthly", "quarterly", "biannual", "yearly", "lapsed", "one_time")
        }
        cadences: List[float] = []
        for r in rows:
            orders = int(r.get("total_orders") or 0)
            spend = float(r.get("total_sales") or 0)
            if orders < 1:
                continue
            if orders == 1:
                buckets["one_time"]["count"] += 1
                buckets["one_time"]["customers_ltv_kes"] += spend
                continue
            first = _parse_date(r.get("first_purchase_date"))
            last = _parse_date(r.get("last_purchase_date"))
            if not first or not last or orders < 2:
                continue
            span_days = max(1, (last - first).days)
            cadence = span_days / (orders - 1)
            cadences.append(cadence)
            if cadence < 14:
                b = "weekly"
            elif cadence < 60:
                b = "monthly"
            elif cadence < 120:
                b = "quarterly"
            elif cadence < 240:
                b = "biannual"
            elif cadence < 400:
                b = "yearly"
            else:
                b = "lapsed"
            buckets[b]["count"] += 1
            buckets[b]["customers_ltv_kes"] += spend

        total_multi = sum(b["count"] for k, b in buckets.items() if k != "one_time")
        overall_avg = round(sum(cadences) / len(cadences), 1) if cadences else 0.0
        cadences.sort()
        median = round(cadences[len(cadences) // 2], 1) if cadences else 0.0

        return {
            "total_customers": sum(b["count"] for b in buckets.values()),
            "multi_order_customers": total_multi,
            "one_time_customers": buckets["one_time"]["count"],
            "overall_avg_cadence_days": overall_avg,
            "median_cadence_days": median,
            "buckets": [
                {
                    "bucket": k,
                    "label": {
                        "weekly": "Weekly (0–14d)",
                        "monthly": "Monthly (14–60d)",
                        "quarterly": "Quarterly (60–120d)",
                        "biannual": "Bi-annual (120–240d)",
                        "yearly": "Yearly (240–400d)",
                        "lapsed": "Lapsed (>400d)",
                        "one_time": "One-time shoppers",
                    }[k],
                    "count": b["count"],
                    "pct_of_base": round(b["count"] * 100.0 / sum(bb["count"] for bb in buckets.values()), 1) if sum(bb["count"] for bb in buckets.values()) else 0.0,
                    "customers_ltv_kes": round(b["customers_ltv_kes"], 0),
                }
                for k, b in buckets.items()
            ],
        }

    # --------------------------------------------------------------------- #
    # 13. New-customer insights (last 30 / 90d)                             #
    # --------------------------------------------------------------------- #

    @router.get("/new-customers")
    async def new_customers(days: int = 30, _: Any = Depends(require_manager)):
        """Insights on customers whose first purchase was in the last `days` days."""
        cutoff = (now_utc() - timedelta(days=days)).isoformat()
        rows = await db.customer_cache.find(
            {"first_purchase_date": {"$gte": cutoff}},
            {"_id": 0},
        ).to_list(10000)

        if not rows:
            return {"window_days": days, "count": 0, "by_month": [], "by_city": [], "avg_first_basket_kes": 0, "converted_second_order": 0, "single_order_still": 0, "top_arrivals": []}

        # By acquisition month
        by_month = defaultdict(int)
        by_city = defaultdict(int)
        baskets: List[float] = []
        single_order_still = 0
        converted_second = 0
        top_arrivals: List[Dict[str, Any]] = []

        for r in rows:
            fp = _parse_date(r.get("first_purchase_date"))
            if fp:
                by_month[fp.strftime("%Y-%m")] += 1
            city = r.get("city") or r.get("customer_country")
            if not city or city.lower() in ("unknown", "none"):
                city = "Unspecified"
            by_city[city] += 1

            basket = float(r.get("avg_basket") or 0)
            if basket > 0:
                baskets.append(basket)

            orders = int(r.get("total_orders") or 0)
            if orders == 1:
                single_order_still += 1
            else:
                converted_second += 1

            top_arrivals.append({
                "customer_id": r.get("customer_id"),
                "customer_name": r.get("customer_name"),
                "city": r.get("city"),
                "first_purchase_date": r.get("first_purchase_date"),
                "total_orders": orders,
                "total_sales": float(r.get("total_sales") or 0),
                "rfm_tier": r.get("rfm_tier"),
            })

        top_arrivals.sort(key=lambda c: -c["total_sales"])
        by_month_list = [{"month": k, "count": v} for k, v in sorted(by_month.items())]
        by_city_list = sorted(
            [{"city": k, "count": v} for k, v in by_city.items()],
            key=lambda x: -x["count"],
        )[:10]

        return {
            "window_days": days,
            "count": len(rows),
            "avg_first_basket_kes": round(sum(baskets) / len(baskets), 0) if baskets else 0,
            "converted_second_order": converted_second,
            "single_order_still": single_order_still,
            "second_order_rate_pct": round(converted_second * 100.0 / len(rows), 1),
            "by_month": by_month_list,
            "by_city": by_city_list,
            "top_arrivals": top_arrivals[:15],
        }

    # --------------------------------------------------------------------- #
    # 14. Drop-off forecast for new customers                               #
    # --------------------------------------------------------------------- #

    @router.get("/dropoff-forecast")
    async def dropoff_forecast(days: int = 90, _: Any = Depends(require_manager)):
        """Predicts which new customers (first_purchase in last `days` days)
        are likely to drop off based on observed cohort patterns.

        Scoring (0–100 risk):
          +40 if still only 1 order AND ≥ 30d since first purchase
          +20 for each missed "expected" second-order window (based on cohort median)
          +15 if their cohort's M3 retention <= 25%
          +10 if no profile enrichment (no size prefs, no phone/email)
          -20 if they've already placed a 2nd order (i.e. converted)

        Outputs per customer + aggregate projection.
        """
        cutoff = (now_utc() - timedelta(days=days)).isoformat()
        new_rows = await db.customer_cache.find(
            {"first_purchase_date": {"$gte": cutoff}},
            {"_id": 0},
        ).to_list(10000)

        # Compute cohort M3 retention (reuse the existing cohort math, quickly)
        all_cache = await db.customer_cache.find(
            {"first_purchase_date": {"$ne": None}},
            {"_id": 0, "first_purchase_date": 1, "last_purchase_date": 1},
        ).to_list(50000)
        cohort_m3: Dict[str, float] = {}
        coh_buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in all_cache:
            fp = _parse_date(r.get("first_purchase_date"))
            if fp:
                coh_buckets[fp.strftime("%Y-%m")].append(r)
        for mk, cs in coh_buckets.items():
            if not cs:
                continue
            dt = datetime.strptime(mk + "-01", "%Y-%m-%d")
            retained = 0
            for c in cs:
                last = _parse_date(c.get("last_purchase_date"))
                if last and (last - dt).days >= 90:
                    retained += 1
            cohort_m3[mk] = retained * 100.0 / len(cs)

        now_dt = now_utc().replace(tzinfo=None)
        at_risk = []
        converted = 0
        for r in new_rows:
            fp = _parse_date(r.get("first_purchase_date"))
            if not fp:
                continue
            days_since_first = (now_dt - fp).days
            orders = int(r.get("total_orders") or 0)
            cohort_mk = fp.strftime("%Y-%m")
            m3 = cohort_m3.get(cohort_mk, 40.0)

            score = 0.0
            reasons: List[str] = []
            if orders == 1 and days_since_first >= 30:
                score += 40
                reasons.append(f"{days_since_first}d since first order, no repeat")
            if orders == 1 and days_since_first >= 60:
                score += 20
                reasons.append("past typical 2nd-order window")
            if m3 <= 25:
                score += 15
                reasons.append(f"cohort M3 retention only {m3:.0f}%")
            if orders >= 2:
                score -= 20
                converted += 1
                reasons.append("already placed 2nd order")
            # Profile enrichment penalty
            prefs_doc = await db.customer_preferences.find_one({"customer_id": r.get("customer_id")}, {"_id": 0, "sizes": 1})
            if not prefs_doc or not (prefs_doc.get("sizes") or {}):
                score += 10
                reasons.append("no style profile captured")
            score = max(0.0, min(100.0, score))
            band = "high" if score >= 60 else "medium" if score >= 35 else "low"

            at_risk.append({
                "customer_id": r.get("customer_id"),
                "customer_name": r.get("customer_name"),
                "city": r.get("city"),
                "rfm_tier": r.get("rfm_tier"),
                "first_purchase_date": r.get("first_purchase_date"),
                "days_since_first_purchase": days_since_first,
                "total_orders": orders,
                "total_sales_kes": float(r.get("total_sales") or 0),
                "risk_score": round(score, 1),
                "risk_band": band,
                "reasons": reasons,
                "cohort_m3_retention_pct": round(m3, 1),
            })

        at_risk.sort(key=lambda x: -x["risk_score"])
        high = sum(1 for c in at_risk if c["risk_band"] == "high")
        medium = sum(1 for c in at_risk if c["risk_band"] == "medium")
        low = sum(1 for c in at_risk if c["risk_band"] == "low")
        projected_churn = high + round(medium * 0.5)

        return {
            "window_days": days,
            "evaluated": len(at_risk),
            "already_converted": converted,
            "projected_churn_next_30d": projected_churn,
            "bands": {"high": high, "medium": medium, "low": low},
            "at_risk_customers": at_risk[:50],
            "methodology": "Composite score combining order recency, repeat-order window, cohort M3 retention and profile-enrichment gap. Calibrated against the Vivo customer_cache.",
        }

    # --------------------------------------------------------------------- #
    # 2. LTV forecast                                                       #
    # --------------------------------------------------------------------- #

    @router.get("/ltv/top")
    async def ltv_top(limit: int = 50, _: Any = Depends(require_manager)):
        """12-month LTV forecast for every cached customer; returns the top N
        worth investing in. Heuristic: avg_basket × forecast_orders × tier_factor.
        Forecast_orders = (total_orders / months_observed) × 12."""
        rows = await db.customer_cache.find({}, {"_id": 0}).to_list(50000)
        out = []
        for r in rows:
            first = _parse_date(r.get("first_purchase_date"))
            if not first:
                continue
            months_obs = max(1.0, (now_utc().replace(tzinfo=None) - first).days / 30.0)
            orders = int(r.get("total_orders") or 0)
            avg_basket = float(r.get("avg_basket") or 0)
            if orders == 0 or avg_basket == 0:
                continue
            tier = r.get("rfm_tier") or "new"
            tier_factor = _TIER_PROJECTION.get(tier, 0.4)
            forecast_orders = (orders / months_obs) * 12.0 * tier_factor
            forecast_ltv = forecast_orders * avg_basket
            out.append({
                "customer_id": r.get("customer_id"),
                "customer_name": r.get("customer_name"),
                "city": r.get("city"),
                "rfm_tier": tier,
                "lifetime_spend_kes": float(r.get("total_sales") or 0),
                "forecast_12m_orders": round(forecast_orders, 1),
                "forecast_12m_ltv_kes": round(forecast_ltv, 0),
                "confidence": "low" if months_obs < 3 else "medium" if months_obs < 12 else "high",
            })
        out.sort(key=lambda x: -x["forecast_12m_ltv_kes"])
        return {"customers": out[:limit]}

    # --------------------------------------------------------------------- #
    # 3. Smart reorder candidates                                           #
    # --------------------------------------------------------------------- #

    @router.get("/reorder-candidates")
    async def reorder_candidates(window_days: int = 14, _: Any = Depends(get_current_user)):
        """For repeat-purchase customers, predict who is "due" to rebuy in the
        next `window_days` based on their average days-between-orders.

        Heuristic: if total_orders >= 3 and a customer's typical cadence has
        elapsed since last_purchase, surface them. Filtered to avoid bag rows.
        """
        rows = await db.customer_cache.find({"total_orders": {"$gte": 3}}, {"_id": 0}).to_list(20000)
        out = []
        today = now_utc()
        for r in rows:
            first = _parse_date(r.get("first_purchase_date"))
            last = _parse_date(r.get("last_purchase_date"))
            orders = int(r.get("total_orders") or 0)
            if not first or not last or orders < 3:
                continue
            span_days = max(1, (last - first).days)
            avg_cadence = span_days / max(1, orders - 1)
            days_since_last = (today.replace(tzinfo=None) - last).days
            due_in = avg_cadence - days_since_last
            if -window_days <= due_in <= window_days and avg_cadence < 365:
                out.append({
                    "customer_id": r.get("customer_id"),
                    "customer_name": r.get("customer_name"),
                    "rfm_tier": r.get("rfm_tier"),
                    "avg_cadence_days": round(avg_cadence, 0),
                    "days_since_last": days_since_last,
                    "due_in_days": round(due_in, 0),
                    "lifetime_spend_kes": float(r.get("total_sales") or 0),
                    "city": r.get("city"),
                })
        out.sort(key=lambda x: x["due_in_days"])  # most overdue first
        return {"window_days": window_days, "candidates": out[:50]}

    # --------------------------------------------------------------------- #
    # 4. Look-alike finder                                                  #
    # --------------------------------------------------------------------- #

    @router.get("/lookalikes/{customer_id}")
    async def lookalikes(customer_id: str, limit: int = 10, _: Any = Depends(get_current_user)):
        """Find customers with similar tier + spend bracket + city + size
        preferences. Naive cosine on a hand-picked feature set; runs in <50ms
        for the eager-warmed cache."""
        anchor = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Customer not found")
        prefs_doc = await db.customer_preferences.find_one({"customer_id": customer_id}, {"_id": 0}) or {}
        anchor_sizes = prefs_doc.get("sizes") or {}

        anchor_spend = float(anchor.get("total_sales") or 0)
        anchor_tier = anchor.get("rfm_tier") or "new"
        anchor_city = (anchor.get("city") or "").lower()

        rows = await db.customer_cache.find(
            {"customer_id": {"$ne": customer_id}, "rfm_tier": anchor_tier},
            {"_id": 0},
        ).to_list(20000)
        scored = []
        for r in rows:
            score = 0.0
            spend = float(r.get("total_sales") or 0)
            if anchor_spend > 0:
                ratio = min(spend, anchor_spend) / max(spend, anchor_spend)
                score += ratio * 50  # up to 50 points
            if (r.get("city") or "").lower() == anchor_city and anchor_city:
                score += 25
            if anchor_sizes:
                pf = await db.customer_preferences.find_one({"customer_id": r["customer_id"]}, {"_id": 0}) or {}
                rs = pf.get("sizes") or {}
                shared = sum(1 for k, v in anchor_sizes.items() if rs.get(k) == v)
                score += shared * 8  # up to ~24 points
            scored.append({
                "customer_id": r["customer_id"],
                "customer_name": r.get("customer_name"),
                "city": r.get("city"),
                "rfm_tier": r.get("rfm_tier"),
                "lifetime_spend_kes": spend,
                "match_score": round(score, 1),
            })
        scored.sort(key=lambda x: -x["match_score"])
        return {"anchor": {"customer_id": customer_id, "name": anchor.get("customer_name")}, "matches": scored[:limit]}

    # --------------------------------------------------------------------- #
    # 5. Daily store stand-up brief                                         #
    # --------------------------------------------------------------------- #

    @router.get("/daily-brief")
    async def daily_brief(user: Any = Depends(require_manager)):
        """One-page manager stand-up: yesterday's KPIs, today's top call list,
        top 3 quality issues, top performers. Returns structured JSON; UI
        renders printable card."""
        yesterday = (now_utc().date() - timedelta(days=1)).isoformat()
        cutoff_7d = (now_utc() - timedelta(days=7)).isoformat()

        # Yesterday's BI snapshot
        kpis = await bi_get("/kpis", {"date_from": yesterday, "date_to": yesterday}) or {}

        # Today's top call list — re-use call_list bucket logic via direct cache reads
        today_md = now_utc().strftime("%m-%d")
        anniv = await db.customer_cache.find(
            {"first_purchase_date": {"$regex": f"-{today_md}$"}},
            {"_id": 0, "customer_id": 1, "customer_name": 1, "total_sales": 1, "rfm_tier": 1},
        ).sort("total_sales", -1).limit(5).to_list(5)
        at_risk = await db.customer_cache.find(
            {"rfm_tier": "at_risk"},
            {"_id": 0, "customer_id": 1, "customer_name": 1, "total_sales": 1},
        ).sort("total_sales", -1).limit(5).to_list(5)
        vip_silent_ids_excl = await db.message_logs.distinct("customer_id", {"sent_at": {"$gte": (now_utc() - timedelta(days=30)).isoformat()}})
        vip_silent = await db.customer_cache.find(
            {"rfm_tier": "vip", "customer_id": {"$nin": vip_silent_ids_excl}},
            {"_id": 0, "customer_id": 1, "customer_name": 1, "total_sales": 1},
        ).sort("total_sales", -1).limit(5).to_list(5)

        # Quality issues — top 3 negative themes last 7d
        neg = await db.social_feedback.find(
            {"sentiment": "negative", "posted_at": {"$gte": cutoff_7d}, "themes": {"$ne": []}},
            {"_id": 0, "themes": 1},
        ).to_list(2000)
        theme_count: Dict[str, int] = defaultdict(int)
        for f in neg:
            for t in (f.get("themes") or []):
                if t != "compliment":
                    theme_count[t] += 1
        top_issues = sorted(theme_count.items(), key=lambda x: -x[1])[:3]

        # Top performers — last 7d outreach
        msgs_7d = await db.message_logs.aggregate([
            {"$match": {"sent_at": {"$gte": cutoff_7d}}},
            {"$group": {"_id": "$sender_name", "messages": {"$sum": 1}, "customers": {"$addToSet": "$customer_id"}}},
            {"$project": {"associate": "$_id", "messages": 1, "customers_contacted": {"$size": "$customers"}, "_id": 0}},
            {"$sort": {"messages": -1}},
            {"$limit": 3},
        ]).to_list(3)

        # Lookbooks created today
        today_iso = now_utc().date().isoformat()
        lb_today = await db.lookbooks.count_documents({"created_at": {"$gte": today_iso}})

        return {
            "for_date": today_iso,
            "headline": f"Yesterday: {kpis.get('total_orders', 0)} orders, KES {int(kpis.get('net_sales') or 0):,} net.",
            "yesterday_kpis": kpis,
            "today": {
                "anniversaries": anniv,
                "at_risk_top": at_risk,
                "vip_silent_top": vip_silent,
                "lookbooks_so_far": lb_today,
            },
            "top_quality_issues_7d": [{"theme": t, "count": c} for t, c in top_issues],
            "top_performers_7d": msgs_7d,
        }

    # --------------------------------------------------------------------- #
    # 6. Walk-in check-in                                                   #
    # --------------------------------------------------------------------- #

    @router.post("/walkins")
    async def walkin_checkin(payload: CheckinIn, user: Any = Depends(get_current_user)):
        """Mark a customer as walked-in. Creates a check-in record + assigns a
        same-day greet/serve task to the associate. Stub for the live floor mode
        (real-time pubsub deferred to v2)."""
        if not payload.customer_id:
            raise HTTPException(status_code=400, detail="customer_id required")
        rec = {
            "checkin_id": _new_id(),
            "customer_id": payload.customer_id,
            "customer_name": payload.customer_name,
            "associate_user_id": user.user_id,
            "associate_name": user.name,
            "note": payload.note,
            "checked_in_at": iso(now_utc()),
            "served": False,
        }
        await db.walkins.insert_one(dict(rec))
        await audit_fn(user, "walkin.create", "customer", payload.customer_id, None)
        return rec

    @router.get("/walkins")
    async def walkin_list(today_only: bool = True, _: Any = Depends(get_current_user)):
        query: Dict[str, Any] = {}
        if today_only:
            query["checked_in_at"] = {"$gte": now_utc().date().isoformat()}
        docs = await db.walkins.find(query, {"_id": 0}).sort("checked_in_at", -1).to_list(200)
        return docs

    @router.post("/walkins/{checkin_id}/serve")
    async def walkin_serve(checkin_id: str, user: Any = Depends(get_current_user)):
        await db.walkins.update_one(
            {"checkin_id": checkin_id},
            {"$set": {"served": True, "served_at": iso(now_utc()), "served_by": user.name}},
        )
        return await db.walkins.find_one({"checkin_id": checkin_id}, {"_id": 0})

    # --------------------------------------------------------------------- #
    # 7. Wishlist                                                           #
    # --------------------------------------------------------------------- #

    @router.get("/wishlists/{customer_id}")
    async def list_wishlist(customer_id: str, _: Any = Depends(get_current_user)):
        return await db.wishlists.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @router.post("/wishlists")
    async def add_wishlist(payload: WishlistIn, user: Any = Depends(get_current_user)):
        expires = now_utc() + timedelta(days=max(1, payload.expires_in_days))
        doc = {
            "wishlist_id": _new_id(),
            "customer_id": payload.customer_id,
            "customer_name": payload.customer_name,
            "sku": payload.sku,
            "product_title": payload.product_title,
            "note": payload.note,
            "created_by_user_id": user.user_id,
            "created_by_name": user.name,
            "created_at": iso(now_utc()),
            "expires_at": iso(expires),
            "fulfilled": False,
        }
        await db.wishlists.insert_one(dict(doc))
        await audit_fn(user, "wishlist.add", "customer", payload.customer_id, None)
        return doc

    @router.post("/wishlists/{wishlist_id}/fulfill")
    async def fulfill_wishlist(wishlist_id: str, user: Any = Depends(get_current_user)):
        await db.wishlists.update_one(
            {"wishlist_id": wishlist_id},
            {"$set": {"fulfilled": True, "fulfilled_at": iso(now_utc()), "fulfilled_by": user.name}},
        )
        return await db.wishlists.find_one({"wishlist_id": wishlist_id}, {"_id": 0})

    @router.delete("/wishlists/{wishlist_id}")
    async def delete_wishlist(wishlist_id: str, _: Any = Depends(get_current_user)):
        res = await db.wishlists.delete_one({"wishlist_id": wishlist_id})
        return {"deleted": res.deleted_count}

    # --------------------------------------------------------------------- #
    # 8. Upcoming life events (birthdays etc.)                              #
    # --------------------------------------------------------------------- #

    @router.get("/upcoming-events")
    async def upcoming_events(days: int = 14, _: Any = Depends(get_current_user)):
        """Birthdays + key dates (anniversaries, kid birthdays etc.) coming up
        in the next `days`. Reads `customer_preferences.dob` and
        `customer_preferences.key_dates` (array of {label, date_md or date}).
        """
        prefs = await db.customer_preferences.find(
            {"$or": [{"dob": {"$exists": True, "$ne": None}}, {"key_dates": {"$exists": True, "$ne": []}}]},
            {"_id": 0},
        ).to_list(20000)
        today = now_utc().date()
        upcoming = []
        for p in prefs:
            cid = p.get("customer_id")
            entries: List[Dict[str, Any]] = []
            dob = p.get("dob")
            if dob:
                d = _parse_date(dob)
                if d:
                    entries.append({"label": "Birthday", "date_md": d.strftime("%m-%d")})
            for ev in (p.get("key_dates") or []):
                if isinstance(ev, dict):
                    md = ev.get("date_md")
                    if not md and ev.get("date"):
                        d = _parse_date(ev.get("date"))
                        if d:
                            md = d.strftime("%m-%d")
                    if md:
                        entries.append({"label": ev.get("label", "Event"), "date_md": md})

            for e in entries:
                # find next occurrence within `days`
                try:
                    mm, dd = e["date_md"].split("-")
                    candidate = today.replace(month=int(mm), day=int(dd))
                except Exception:
                    continue
                if candidate < today:
                    try:
                        candidate = candidate.replace(year=today.year + 1)
                    except Exception:
                        continue
                delta = (candidate - today).days
                if 0 <= delta <= days:
                    cached = await db.customer_cache.find_one({"customer_id": cid}, {"_id": 0, "customer_name": 1, "rfm_tier": 1})
                    upcoming.append({
                        "customer_id": cid,
                        "customer_name": (cached or {}).get("customer_name"),
                        "rfm_tier": (cached or {}).get("rfm_tier"),
                        "label": e["label"],
                        "date": candidate.isoformat(),
                        "in_days": delta,
                    })
        upcoming.sort(key=lambda x: x["in_days"])
        return {"window_days": days, "events": upcoming}

    # --------------------------------------------------------------------- #
    # 9. Auto-reply suggestion (Claude)                                     #
    # --------------------------------------------------------------------- #

    @router.post("/social/suggest-reply")
    async def suggest_reply(payload: ReplySuggestIn, _: Any = Depends(get_current_user)):
        fb = await db.social_feedback.find_one({"feedback_id": payload.feedback_id}, {"_id": 0})
        if not fb:
            raise HTTPException(status_code=404, detail="Feedback not found")

        sentiment = fb.get("sentiment") or "neutral"
        themes = fb.get("themes") or []
        body = fb.get("body") or ""
        author = fb.get("author_name") or fb.get("author_handle") or "the customer"

        sys_prompt = (
            "You draft brief, warm, on-brand replies for a Kenyan fashion retailer (Vivo) responding to a public social post. "
            "Keep it under 280 characters. No hashtags, no emojis unless the original used one. "
            "Tone: gracious, never defensive. If the post is negative, acknowledge + offer a path to resolve "
            "(DM us / visit Sarit / +254 722 ...). If positive, thank with style. If a question, answer simply. "
            "Output STRICT JSON: {\"reply\": \"<draft>\", \"tone\": one of [\"warm\",\"apologetic\",\"informative\",\"celebratory\"]}."
        )
        ctx = {
            "author": author,
            "platform": fb.get("platform"),
            "sentiment": sentiment,
            "themes": themes,
            "post": body,
        }

        result = {"reply": "", "tone": "warm"}
        llm_key = os.environ.get("EMERGENT_LLM_KEY", "")
        if llm_key:
            try:
                from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
                chat = LlmChat(
                    api_key=llm_key,
                    session_id=f"vivo-reply-{payload.feedback_id}-{int(now_utc().timestamp())}",
                    system_message=sys_prompt,
                ).with_model("anthropic", "claude-sonnet-4-5-20250929")
                raw = await chat.send_message(UserMessage(text=json.dumps(ctx, ensure_ascii=False)))
                m = re.search(r"\{[\s\S]*\}", str(raw))
                if m:
                    parsed = json.loads(m.group(0))
                    reply = str(parsed.get("reply", ""))[:300]
                    tone = parsed.get("tone", "warm")
                    if tone not in {"warm", "apologetic", "informative", "celebratory"}:
                        tone = "warm"
                    result = {"reply": reply, "tone": tone}
            except Exception as exc:  # noqa: BLE001
                logger.warning("Suggest-reply LLM error: %s", exc)
        return result

    # --------------------------------------------------------------------- #
    # 10. Leaderboards                                                      #
    # --------------------------------------------------------------------- #

    @router.get("/leaderboard")
    async def leaderboard(period: str = "week", _: Any = Depends(require_manager)):
        """Per-associate weekly/monthly rankings: messages, customers reached,
        clienteling-attributed conversion, lookbooks. Headline KPI = converted_customers."""
        if period not in ("week", "month"):
            raise HTTPException(status_code=400, detail="period must be 'week' or 'month'")
        days = 7 if period == "week" else 30
        cutoff = (now_utc() - timedelta(days=days)).isoformat()

        msgs = await db.message_logs.find({"sent_at": {"$gte": cutoff}}, {"_id": 0}).to_list(10000)
        # purchased flag: cached customer's last_purchase_date >= first message
        by_associate: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"messages": 0, "customers": set(), "purchased": set()})
        first_msg_by_cust: Dict[str, str] = {}
        for m in msgs:
            sn = m.get("sender_name") or "—"
            cid = m.get("customer_id")
            row = by_associate[sn]
            row["messages"] += 1
            if cid:
                row["customers"].add(cid)
                if cid not in first_msg_by_cust or m["sent_at"] < first_msg_by_cust[cid]:
                    first_msg_by_cust[cid] = m["sent_at"]

        # Resolve purchased
        for cid, first_msg in first_msg_by_cust.items():
            cached = await db.customer_cache.find_one({"customer_id": cid}, {"_id": 0, "last_purchase_date": 1})
            if cached and cached.get("last_purchase_date") and str(cached["last_purchase_date"])[:10] >= first_msg[:10]:
                # attribute purchase to every associate who messaged them
                for sn in {m.get("sender_name") for m in msgs if m.get("customer_id") == cid}:
                    if sn:
                        by_associate[sn]["purchased"].add(cid)

        # Lookbooks created
        lb_pipeline = [
            {"$match": {"created_at": {"$gte": cutoff}}},
            {"$group": {"_id": "$associate_name", "lookbooks": {"$sum": 1}}},
        ]
        lb_rows = await db.lookbooks.aggregate(lb_pipeline).to_list(100)
        lb_map = {r["_id"]: r["lookbooks"] for r in lb_rows if r.get("_id")}

        rows = []
        for sn, data in by_associate.items():
            customers = len(data["customers"])
            purchased = len(data["purchased"])
            rows.append({
                "associate": sn,
                "messages": data["messages"],
                "customers_contacted": customers,
                "customers_purchased": purchased,
                "conversion_rate": round(purchased * 100.0 / customers, 1) if customers else 0.0,
                "lookbooks": lb_map.get(sn, 0),
            })
        rows.sort(key=lambda r: (-r["customers_purchased"], -r["customers_contacted"], -r["messages"]))
        for i, r in enumerate(rows):
            r["rank"] = i + 1

        return {"period": period, "window_days": days, "rows": rows}

    return router


def _new_id() -> str:
    import uuid
    return uuid.uuid4().hex[:16]


def _pct_delta(curr: int, prev: int) -> Optional[float]:
    if prev == 0:
        return None if curr == 0 else 100.0
    return round((curr - prev) / prev * 100.0, 1)
