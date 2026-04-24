"""
Leaderboard snapshot & streaks service.

Stores monthly badge-award rows in Mongo so that the dashboard can show
loyalty streaks alongside the winners strip ("🏆 Top Seller: Vivo Sarit ·
🔥 3 months running").

Collection: `leaderboard_snapshots`
Shape per document (one row per period × badge):
    {
        period: "2026-01",          # ISO yyyy-mm
        badge: "top_seller"         # top_seller | highest_abv | top_conversion
                                    # (biggest_mover is intrinsically
                                    # comparison-period dependent so we do
                                    # NOT persist it)
        winner: "Online - Shop Zetu",
        value: 7039525.0,           # headline metric at award time
        computed_at: datetime (utc),
    }

Composite unique index on (period, badge) so idempotent re-runs upsert.

Design notes:
- We only snapshot COMPLETE months — never the current month (a partial month
  can let a store steal a streak, then lose it by month-end).
- Streak = consecutive months (ending at most in the previous complete month)
  where the same `winner` has held the same badge.
- Thresholds mirror the frontend `useLocationBadges` hook:
    Highest ABV      → requires ≥ 50 orders in the period
    Top Conversion   → requires ≥ 200 footfall visits in the period
  to prevent tiny-volume locations from stealing streaks.
"""

import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional

from auth import db

BADGE_KEYS = ("top_seller", "highest_abv", "top_conversion")
MAX_MONTHS_BACK = 6    # bounded lookup → cap unbounded upstream work


def _month_bounds(period: str) -> tuple[str, str]:
    """period "YYYY-MM" → ("YYYY-MM-01", "YYYY-MM-<last>")."""
    from calendar import monthrange
    y, m = period.split("-")
    y, m = int(y), int(m)
    last_day = monthrange(y, m)[1]
    return (f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last_day:02d}")


def _prev_month(period: str) -> str:
    y, m = period.split("-")
    y, m = int(y), int(m)
    if m == 1:
        return f"{y - 1:04d}-12"
    return f"{y:04d}-{m - 1:02d}"


def _previous_complete_period(today: Optional[datetime] = None) -> str:
    """Return the ISO yyyy-mm of the most recent COMPLETE month."""
    today = today or datetime.now(timezone.utc)
    if today.month == 1:
        return f"{today.year - 1:04d}-12"
    return f"{today.year:04d}-{today.month - 1:02d}"


async def _ensure_index():
    try:
        await db.leaderboard_snapshots.create_index(
            [("period", 1), ("badge", 1)], unique=True, background=True,
        )
    except Exception:
        pass


async def _compute_winners_for_period(period: str) -> Dict[str, Optional[dict]]:
    """
    Fetch the raw data for a single month and return {badge_key: winner_row}.
    Leaves the three-badge contract identical to the frontend hook.
    """
    # Lazy import to avoid circular (server.py imports us back).
    from server import get_sales_summary, get_footfall

    date_from, date_to = _month_bounds(period)
    sales, footfall = await asyncio.gather(
        get_sales_summary(date_from=date_from, date_to=date_to),
        get_footfall(date_from=date_from, date_to=date_to),
    )
    if not isinstance(sales, list):
        sales = []
    if not isinstance(footfall, list):
        footfall = []

    ff_by_loc = {r.get("location"): r.get("total_footfall") or 0 for r in footfall}
    rows = []
    for r in sales:
        channel = r.get("channel")
        if not channel:
            continue
        total_sales = r.get("total_sales") or 0
        orders = r.get("orders") or r.get("total_orders") or 0
        abv = (total_sales / orders) if orders else 0
        ff = ff_by_loc.get(channel, 0)
        cr = ((orders / ff) * 100) if ff else 0
        rows.append({
            "channel": channel, "sales": total_sales, "orders": orders,
            "abv": abv, "ff": ff, "cr": cr,
        })

    winners: Dict[str, Optional[dict]] = {k: None for k in BADGE_KEYS}

    top_seller = max(rows, key=lambda r: r["sales"], default=None)
    if top_seller and top_seller["sales"] > 0:
        winners["top_seller"] = {"winner": top_seller["channel"], "value": top_seller["sales"]}

    abv_candidates = [r for r in rows if r["orders"] >= 50]
    top_abv = max(abv_candidates, key=lambda r: r["abv"], default=None)
    if top_abv:
        winners["highest_abv"] = {"winner": top_abv["channel"], "value": top_abv["abv"]}

    # Top Conversion: floor at ≥200 visits, cap at ≤50% CR to filter
    # broken-counter rows (matches the Footfall page's data-quality rule).
    cr_candidates = [r for r in rows if r["ff"] >= 200 and r["cr"] <= 50]
    top_cr = max(cr_candidates, key=lambda r: r["cr"], default=None)
    if top_cr and top_cr["cr"] > 0:
        winners["top_conversion"] = {"winner": top_cr["channel"], "value": top_cr["cr"]}

    return winners


async def _detect_record(badge: str, period: str, value: float) -> bool:
    """
    True when `value` exceeds the max value seen for `badge` across the prior
    12 complete months (excluding the period being snapshotted itself).
    """
    try:
        # Build the 12 prior months we care about.
        periods: List[str] = []
        cur = _prev_month(period)
        for _ in range(12):
            periods.append(cur)
            cur = _prev_month(cur)
        prior_max = None
        async for doc in db.leaderboard_snapshots.find(
            {"badge": badge, "period": {"$in": periods}}, {"_id": 0, "value": 1}
        ):
            v = doc.get("value") or 0
            if prior_max is None or v > prior_max:
                prior_max = v
        # No prior data ⇒ cannot claim a record (avoid month-1 artifact).
        if prior_max is None:
            return False
        return value > prior_max
    except Exception:
        return False


async def snapshot_period(period: str, force: bool = False) -> Dict[str, dict]:
    """
    Idempotent: if a snapshot exists for `period`, short-circuits unless force=True.
    Returns {badge: snapshot_doc}.
    """
    await _ensure_index()
    if not force:
        existing = {
            doc["badge"]: doc
            async for doc in db.leaderboard_snapshots.find({"period": period}, {"_id": 0})
        }
        if set(existing.keys()) >= set(BADGE_KEYS):
            return existing

    winners = await _compute_winners_for_period(period)
    now = datetime.now(timezone.utc)
    out: Dict[str, dict] = {}
    for badge in BADGE_KEYS:
        w = winners.get(badge)
        if not w:
            continue
        is_record = await _detect_record(badge, period, w["value"])
        doc = {
            "period": period,
            "badge": badge,
            "winner": w["winner"],
            "value": w["value"],
            "is_record": is_record,
            "computed_at": now,
        }
        await db.leaderboard_snapshots.update_one(
            {"period": period, "badge": badge},
            {"$set": doc},
            upsert=True,
        )
        out[badge] = doc
    return out


async def get_streaks(lookback_months: int = MAX_MONTHS_BACK) -> Dict[str, Dict[str, object]]:
    """
    Returns:
      {
        "top_seller":     {"Shop Zetu": 3, ...},
        "highest_abv":    {...},
        "top_conversion": {...},
        "records":        {"top_seller": {"winner": "Shop Zetu", "value": 7039525},
                           "highest_abv": null, ...},
      }
    `records` flags the MOST RECENT complete month only — if that month's
    winner set an all-time high relative to the prior 12 months, we surface
    a record badge on the strip (active only while the "current period"
    result for that badge matches the record-setting winner).
    """
    lookback_months = max(1, min(MAX_MONTHS_BACK, int(lookback_months)))
    await _ensure_index()

    periods: List[str] = []
    cur = _previous_complete_period()
    for _ in range(lookback_months):
        periods.append(cur)
        cur = _prev_month(cur)

    # Backfill any missing snapshots in parallel.
    existing_periods = {
        doc["period"]
        async for doc in db.leaderboard_snapshots.find(
            {"period": {"$in": periods}}, {"period": 1, "_id": 0}
        )
    }
    missing = [p for p in periods if p not in existing_periods]
    if missing:
        sem = asyncio.Semaphore(2)

        async def _run(p):
            async with sem:
                try:
                    await snapshot_period(p)
                except Exception:
                    pass

        await asyncio.gather(*[_run(p) for p in missing])

    # Now read all back, keyed by period.
    by_period: Dict[str, Dict[str, dict]] = {p: {} for p in periods}
    async for doc in db.leaderboard_snapshots.find({"period": {"$in": periods}}, {"_id": 0}):
        by_period.setdefault(doc["period"], {})[doc["badge"]] = doc

    streaks: Dict[str, Dict[str, int]] = {k: {} for k in BADGE_KEYS}
    records: Dict[str, Optional[dict]] = {k: None for k in BADGE_KEYS}

    for badge in BADGE_KEYS:
        if not periods:
            continue
        newest = by_period.get(periods[0], {}).get(badge)
        if not newest:
            continue
        channel = newest["winner"]
        # Record flag surfaces only on the most recent complete month.
        if newest.get("is_record"):
            records[badge] = {"winner": channel, "value": newest.get("value") or 0}
        streak = 1
        for p in periods[1:]:
            snap = by_period.get(p, {}).get(badge)
            if snap and snap.get("winner") == channel:
                streak += 1
            else:
                break
        if streak >= 2:
            streaks[badge][channel] = streak
    return {**streaks, "records": records}


# Simple in-memory cache for GET /api/leaderboard/streaks so we don't
# upstream-hammer on every dashboard load. 1-hour TTL is plenty —
# snapshots only change when the month rolls over.
_streaks_cache: Dict[str, tuple] = {}
_STREAKS_TTL = 3600


async def get_streaks_cached(lookback_months: int = MAX_MONTHS_BACK):
    import time as _t
    key = str(lookback_months)
    cached = _streaks_cache.get(key)
    if cached and (_t.time() - cached[0]) < _STREAKS_TTL:
        return cached[1]
    data = await get_streaks(lookback_months=lookback_months)
    _streaks_cache[key] = (_t.time(), data)
    return data


# ---------- Store of the Week ----------
#
# Celebratory recap of the last 7 completed days (today excluded to keep
# numbers final). Returns one dict per badge with current value and pct
# delta vs the prior 7 days — used by the Overview "Store of the Week"
# card.

_sotw_cache: Dict[str, tuple] = {}
_SOTW_TTL = 900  # 15 minutes — day boundary matters, not minute


async def _compute_sotw():
    from datetime import timedelta
    from server import get_sales_summary, get_footfall

    today = datetime.now(timezone.utc).date()
    # Yesterday is the last complete day; window = prior 7 completed days.
    end = today - timedelta(days=1)
    start = end - timedelta(days=6)  # inclusive 7-day window
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)

    def iso(d):
        return d.strftime("%Y-%m-%d")

    sales, prev_sales, footfall, prev_footfall = await asyncio.gather(
        get_sales_summary(date_from=iso(start), date_to=iso(end)),
        get_sales_summary(date_from=iso(prev_start), date_to=iso(prev_end)),
        get_footfall(date_from=iso(start), date_to=iso(end)),
        get_footfall(date_from=iso(prev_start), date_to=iso(prev_end)),
    )
    if not isinstance(sales, list):
        sales = []
    if not isinstance(prev_sales, list):
        prev_sales = []
    if not isinstance(footfall, list):
        footfall = []
    if not isinstance(prev_footfall, list):
        prev_footfall = []

    prev_map = {r.get("channel"): r for r in prev_sales if r.get("channel")}
    ff_by_loc = {r.get("location"): r.get("total_footfall") or 0 for r in footfall}

    rows = []
    for r in sales:
        ch = r.get("channel")
        if not ch:
            continue
        ts = r.get("total_sales") or 0
        orders = r.get("orders") or r.get("total_orders") or 0
        abv = (ts / orders) if orders else 0
        ff = ff_by_loc.get(ch, 0)
        cr = ((orders / ff) * 100) if ff else 0
        p = prev_map.get(ch, {})
        p_sales = p.get("total_sales") or 0
        pct = ((ts - p_sales) / p_sales * 100) if p_sales else None
        rows.append({
            "channel": ch, "sales": ts, "orders": orders,
            "abv": abv, "ff": ff, "cr": cr, "pct_vs_prev_week": pct,
        })

    def pack(row, metric, value_key):
        if not row:
            return None
        return {
            "winner": row["channel"],
            "value": row[metric],
            "sales": row["sales"],
            "orders": row["orders"],
            "pct_vs_prev_week": row.get("pct_vs_prev_week"),
            "metric": value_key,
        }

    top_seller = max(rows, key=lambda r: r["sales"], default=None)
    top_abv = max([r for r in rows if r["orders"] >= 50], key=lambda r: r["abv"], default=None)
    top_cr = max([r for r in rows if r["ff"] >= 200 and r["cr"] <= 50], key=lambda r: r["cr"], default=None)

    return {
        "window": {"start": iso(start), "end": iso(end)},
        "prev_window": {"start": iso(prev_start), "end": iso(prev_end)},
        "top_seller": pack(top_seller, "sales", "sales") if top_seller and top_seller["sales"] > 0 else None,
        "highest_abv": pack(top_abv, "abv", "abv") if top_abv else None,
        "top_conversion": pack(top_cr, "cr", "conversion_rate") if top_cr and top_cr["cr"] > 0 else None,
    }


async def get_store_of_the_week():
    import time as _t
    key = "sotw"
    cached = _sotw_cache.get(key)
    if cached and (_t.time() - cached[0]) < _SOTW_TTL:
        return cached[1]
    try:
        data = await _compute_sotw()
    except Exception as e:
        logger = __import__("logging").getLogger(__name__)
        logger.warning("[leaderboard] store-of-the-week compute failed: %s", e)
        data = {"window": None, "prev_window": None,
                "top_seller": None, "highest_abv": None, "top_conversion": None}
    _sotw_cache[key] = (_t.time(), data)
    return data
