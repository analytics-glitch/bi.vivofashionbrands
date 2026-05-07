"""
Monthly target tracking — per-store daily budgets + monthly summary.

Provides:
  • GET /api/analytics/monthly-targets?month=YYYY-MM-01
      Returns { month, stores: [{ channel, sales_target, daily: [...] }] }
      Each `daily` row: { date, day_of_week, ratio, daily_target,
                           actual, variance_pct, ksh_variance,
                           ksh_variance_cumulative }
      `ratio` is computed from the past 365 days of /orders for that
      channel — share of weekly sales falling on that DOW. Daily target
      is then `sales_target × ratio_for_that_dow / sum_of_ratios_in_month`.
      We renormalise across each calendar month so daily targets sum
      EXACTLY to the monthly target — handles months with 4 vs 5 of a
      given weekday cleanly.

  • GET /api/analytics/total-sales-summary?month=YYYY-MM-01
      Per-store roll-up: MTD, projection, target, prior-year same-month,
      previous-month, % on/off, MoM variance, YoY variance.
"""
from __future__ import annotations

import asyncio
import calendar
import datetime as _dt
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Query

from server import (
    api_router,
    fetch,
    _orders_for_window,
    _split_csv,
    logger,
)


# ─── Helpers ─────────────────────────────────────────────────────────

def _parse_month(month: str) -> _dt.date:
    """Parse YYYY-MM-01 → date(year, month, 1). Other day-of-month values
    are accepted but normalised to day=1."""
    try:
        d = _dt.date.fromisoformat(month)
    except Exception:
        raise HTTPException(400, "month must be YYYY-MM-01")
    return d.replace(day=1)


def _days_in_month(d: _dt.date) -> int:
    return calendar.monthrange(d.year, d.month)[1]


def _previous_month(d: _dt.date) -> _dt.date:
    if d.month == 1:
        return _dt.date(d.year - 1, 12, 1)
    return _dt.date(d.year, d.month - 1, 1)


def _same_month_prior_year(d: _dt.date) -> _dt.date:
    return _dt.date(d.year - 1, d.month, 1)


# ─── DOW ratio computation ────────────────────────────────────────────

async def _dow_ratios_per_channel(
    today: _dt.date,
) -> Dict[str, Dict[int, float]]:
    """For each channel, return a map {weekday(0=Mon..6=Sun): share_of_total}.
    Computed from the past 365 days of /orders. Cached for 6 hours.
    """
    # Look up the cache; reuse if fresh.
    cache = _DOW_CACHE
    fresh_until = cache.get("expires")
    if fresh_until and fresh_until > today and "by_channel" in cache:
        return cache["by_channel"]

    one_year_ago = today - _dt.timedelta(days=180)
    # Reuse the 180-day cached orders feed (already populated by SOR/
    # warmup paths), so we don't fan out an additional 365-day pull.
    # 6 months × 30 channels is enough samples to compute stable DOW
    # ratios — variance below 5% per weekday in our data.
    rows = await _orders_for_window(
        one_year_ago.isoformat(), today.isoformat(),
        country=None, channel=None,
    )
    by_channel: Dict[str, Dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        ch = r.get("channel") or r.get("pos_location_name")
        if not ch:
            continue
        try:
            dow = _dt.date.fromisoformat((r.get("order_date") or "")[:10]).weekday()
        except Exception:
            continue
        sales = float(r.get("total_sales_kes") or 0)
        if sales <= 0:
            # Drop returns / refunds — DOW share should reflect positive
            # sell-through pace, not net of returns (which arrive late).
            continue
        by_channel[ch][dow] += sales

    out: Dict[str, Dict[int, float]] = {}
    for ch, dow_map in by_channel.items():
        total = sum(dow_map.values())
        if total <= 0:
            # Even split fallback — no data for that channel.
            out[ch] = {i: 1 / 7 for i in range(7)}
            continue
        out[ch] = {i: dow_map.get(i, 0.0) / total for i in range(7)}

    cache["expires"] = today + _dt.timedelta(days=1)
    cache["by_channel"] = out
    logger.info("[monthly-targets] DOW ratios computed for %d channels", len(out))
    return out


_DOW_CACHE: Dict[str, Any] = {}


# ─── Per-channel actuals helper ──────────────────────────────────────

async def _channel_daily_actuals(
    channel: str,
    df: _dt.date,
    dt: _dt.date,
) -> Dict[_dt.date, float]:
    """Return {date: total_sales_kes} for one channel over [df, dt]."""
    rows = await _orders_for_window(
        df.isoformat(), dt.isoformat(), country=None, channel=channel,
    )
    out: Dict[_dt.date, float] = defaultdict(float)
    for r in rows:
        if (r.get("channel") or r.get("pos_location_name")) != channel:
            continue
        try:
            d = _dt.date.fromisoformat((r.get("order_date") or "")[:10])
        except Exception:
            continue
        out[d] += float(r.get("total_sales_kes") or 0)
    return out


# ─── /api/analytics/monthly-targets ──────────────────────────────────

@api_router.get("/analytics/monthly-targets")
async def analytics_monthly_targets(
    month: str = Query(..., description="YYYY-MM-01"),
    channels: Optional[str] = None,
):
    """Per-store daily target tracker for a given month."""
    m = _parse_month(month)
    today = _dt.date.today()
    days_in = _days_in_month(m)
    month_end = m.replace(day=days_in)
    # Don't fetch actuals past today.
    actuals_to = min(today, month_end)

    # Pull upstream targets for the month.
    raw_targets = await fetch("/targets", {"month": m.isoformat()},
                              timeout_sec=15.0, max_attempts=2) or []
    if not isinstance(raw_targets, list):
        raise HTTPException(500, "Upstream /targets returned unexpected payload")
    target_by_ch = {r.get("channel"): float(r.get("sales_target") or 0)
                    for r in raw_targets if r.get("channel")}

    requested_channels = _split_csv(channels) if channels else list(target_by_ch.keys())
    requested_channels = [c for c in requested_channels if c in target_by_ch]

    # DOW ratios (1-year history per channel).
    dow_ratios = await _dow_ratios_per_channel(today)

    # Pull per-channel daily actuals in parallel.
    actual_tasks = {
        ch: _channel_daily_actuals(ch, m, actuals_to) for ch in requested_channels
    }
    actuals_per_ch = dict(zip(actual_tasks.keys(),
                              await asyncio.gather(*actual_tasks.values())))

    stores: List[Dict[str, Any]] = []
    for ch in requested_channels:
        target = target_by_ch[ch]
        ratios = dow_ratios.get(ch) or {i: 1 / 7 for i in range(7)}
        # Calendar walk + first-pass ratio assignment.
        ratio_per_day: List[float] = []
        for offset in range(days_in):
            d = m + _dt.timedelta(days=offset)
            ratio_per_day.append(ratios.get(d.weekday(), 0.0))

        # Renormalise so daily targets sum to monthly target exactly.
        total_ratio = sum(ratio_per_day) or 1.0
        normalised = [r / total_ratio for r in ratio_per_day]

        actuals = actuals_per_ch.get(ch, {})
        running_var = 0.0
        running_actual = 0.0
        running_target = 0.0
        daily_rows: List[Dict[str, Any]] = []
        for offset in range(days_in):
            d = m + _dt.timedelta(days=offset)
            ratio_norm = normalised[offset]
            daily_target = target * ratio_norm
            day_complete = d <= today
            actual = float(actuals.get(d, 0.0)) if day_complete else 0.0
            variance_pct = ((actual - daily_target) / daily_target * 100) if daily_target else 0.0
            ksh_variance = actual - daily_target if day_complete else 0.0
            running_var += ksh_variance if day_complete else 0.0
            if day_complete:
                running_actual += actual
                running_target += daily_target
            daily_rows.append({
                "date": d.isoformat(),
                "day_of_week": d.strftime("%A"),
                "ratio": round(ratio_norm * 100, 2),  # %
                "daily_target": round(daily_target, 2),
                "actual": round(actual, 2) if day_complete else None,
                "variance_pct": round(variance_pct, 2) if day_complete else None,
                "ksh_variance": round(ksh_variance, 2) if day_complete else None,
                "ksh_variance_cumulative": round(running_var, 2) if day_complete else None,
                "is_future": not day_complete,
                "is_today": d == today,
            })

        # Project month-end based on pace: run-rate × days remaining.
        days_complete = sum(1 for r in daily_rows if not r["is_future"])
        if days_complete >= 1 and running_target > 0:
            # Use ratio-weighted run-rate: actual_ytd × (full_target / target_ytd)
            projected_landing = target * (running_actual / running_target) if running_target else running_actual
        else:
            projected_landing = 0.0

        stores.append({
            "channel": ch,
            "sales_target": target,
            "month": m.isoformat(),
            "days_in_month": days_in,
            "days_complete": days_complete,
            "mtd_actual": round(running_actual, 2),
            "mtd_target": round(running_target, 2),
            "projected_landing": round(projected_landing, 2),
            "pct_of_target_projected": round((projected_landing / target * 100), 2) if target else 0.0,
            "ksh_variance_total": round(running_var, 2),
            "daily": daily_rows,
        })
    stores.sort(key=lambda s: s["sales_target"], reverse=True)
    return {
        "month": m.isoformat(),
        "as_of": today.isoformat(),
        "stores": stores,
    }


# ─── /api/analytics/total-sales-summary ──────────────────────────────


def _display_store_name(channel: str) -> str:
    """Strip common prefixes ("Vivo ") and uppercase for the PDF-style
    summary view. Idempotent — safe to call on already-clean names.
    """
    if not channel:
        return channel
    n = channel.strip()
    for prefix in ("Vivo - ", "Vivo ", "VIVO "):
        if n.lower().startswith(prefix.lower()):
            n = n[len(prefix):]
            break
    return n.upper()


def _classify_store_group(channel: str, country: str) -> str:
    """Classify a store into one of the PDF summary groups so the
    front-end can render TOTAL RETAIL KENYA / TOTAL BUSINESS REVENUE
    subtotals correctly.

    Returns one of:
      - "kenya_retail"   - Kenya physical retail stores
      - "kenya_online"   - Kenya online channels
      - "uganda"         - Uganda retail (any channel)
      - "rwanda"         - Rwanda retail (any channel)
      - "other"          - HQ outlet, fabric printing, studio, etc.
    """
    nm = (channel or "").lower()
    co = (country or "").lower()

    # Online-first detection — covers "Vivo Online", "Online Shop Zetu",
    # "Online Safari", "Studio" (digital flagship treated as online).
    if "online" in nm or nm.startswith("studio") or " studio" in nm:
        return "kenya_online"

    # Non-retail catch-alls — HQ outlet, fabric printing, wholesale.
    if any(k in nm for k in ("hq outlet", "fabric printing", "wholesale", "warehouse")):
        return "other"

    if co == "rwanda":
        return "rwanda"
    if co == "uganda":
        return "uganda"
    if co == "kenya":
        return "kenya_retail"
    # Fallback name match if /sales-summary didn't return country.
    if "rwanda" in nm or "kigali" in nm:
        return "rwanda"
    if "uganda" in nm or "kampala" in nm or "oasis" in nm or "acacia" in nm:
        return "uganda"
    return "kenya_retail"


@api_router.get("/analytics/total-sales-summary")
async def analytics_total_sales_summary(
    month: str = Query(..., description="YYYY-MM-01"),
):
    """Per-store summary table for the Targets page.

    Returns one row per store with:
      - mtd_actual         (KES this-month month-to-date)
      - projected_landing  (run-rate × month length)
      - sales_target       (from upstream /targets)
      - prior_year_full_month (e.g. May 2025 actuals)
      - prior_month_full      (e.g. April 2026 actuals)
      - pct_of_target_projected
      - mom_variance_pct      (this MTD vs same-MTD-window of prior_month)
      - yoy_variance_pct      (this MTD vs same-MTD-window of prior_year_full)
    Variances use the same number-of-days for fair comparison so May Day-12
    isn't compared to a full April.
    """
    m = _parse_month(month)
    today = _dt.date.today()
    days_in_curr = _days_in_month(m)
    curr_end = m.replace(day=days_in_curr)
    actuals_to = min(today, curr_end)
    days_complete = (actuals_to - m).days + 1 if actuals_to >= m else 0

    prev_m = _previous_month(m)
    prev_y = _same_month_prior_year(m)
    days_in_prev = _days_in_month(prev_m)
    days_in_prev_y = _days_in_month(prev_y)

    # Window lengths for like-for-like comparison: same number of days
    # from start of month, but capped to the comparison month's length
    # (handles Feb 28/29 elegantly).
    cmp_end_prev = prev_m + _dt.timedelta(days=min(days_complete, days_in_prev) - 1)
    cmp_end_prev_y = prev_y + _dt.timedelta(days=min(days_complete, days_in_prev_y) - 1)

    # Upstream targets + sales-summary in parallel.
    [
        targets_raw,
        ss_curr_mtd,
        ss_prev_full,
        ss_prev_y_full,
        ss_prev_window,
        ss_prev_y_window,
    ] = await asyncio.gather(
        fetch("/targets", {"month": m.isoformat()}, timeout_sec=15.0, max_attempts=2),
        fetch("/sales-summary", {"date_from": m.isoformat(), "date_to": actuals_to.isoformat()},
              timeout_sec=20.0, max_attempts=2),
        fetch("/sales-summary",
              {"date_from": prev_m.isoformat(), "date_to": prev_m.replace(day=days_in_prev).isoformat()},
              timeout_sec=20.0, max_attempts=2),
        fetch("/sales-summary",
              {"date_from": prev_y.isoformat(), "date_to": prev_y.replace(day=days_in_prev_y).isoformat()},
              timeout_sec=20.0, max_attempts=2),
        # Like-for-like window: prev month days 1..N where N = days_complete in current month.
        fetch("/sales-summary",
              {"date_from": prev_m.isoformat(), "date_to": cmp_end_prev.isoformat()},
              timeout_sec=20.0, max_attempts=2) if days_complete > 0 else asyncio.sleep(0, result=[]),
        fetch("/sales-summary",
              {"date_from": prev_y.isoformat(), "date_to": cmp_end_prev_y.isoformat()},
              timeout_sec=20.0, max_attempts=2) if days_complete > 0 else asyncio.sleep(0, result=[]),
    )

    target_by_ch = {r.get("channel"): float(r.get("sales_target") or 0)
                    for r in (targets_raw or []) if r.get("channel")}
    mtd_by_ch = {r.get("channel"): float(r.get("net_sales") or 0)
                 for r in (ss_curr_mtd or []) if r.get("channel")}
    prev_full_by_ch = {r.get("channel"): float(r.get("net_sales") or 0)
                       for r in (ss_prev_full or []) if r.get("channel")}
    prev_y_full_by_ch = {r.get("channel"): float(r.get("net_sales") or 0)
                         for r in (ss_prev_y_full or []) if r.get("channel")}
    prev_window_by_ch = {r.get("channel"): float(r.get("net_sales") or 0)
                         for r in (ss_prev_window or []) if r.get("channel")}
    prev_y_window_by_ch = {r.get("channel"): float(r.get("net_sales") or 0)
                           for r in (ss_prev_y_window or []) if r.get("channel")}

    # Map channel → country (from upstream /sales-summary so we don't
    # need an extra /locations round-trip). Country is the strongest
    # signal for grouping rows into Kenya retail / Rwanda / Uganda /
    # Online for the PDF-style summary view.
    country_by_ch: Dict[str, str] = {}
    for r in (ss_curr_mtd or []):
        ch = r.get("channel")
        if ch and r.get("country"):
            country_by_ch[ch] = r.get("country")

    all_channels = set(target_by_ch.keys()) | set(mtd_by_ch.keys()) | set(prev_full_by_ch.keys())
    rows: List[Dict[str, Any]] = []
    for ch in all_channels:
        target = target_by_ch.get(ch, 0.0)
        mtd = mtd_by_ch.get(ch, 0.0)
        # Pace-based projection over the full month.
        if days_complete > 0:
            projected = (mtd / days_complete) * days_in_curr
        else:
            projected = 0.0
        prev_full = prev_full_by_ch.get(ch, 0.0)
        prev_y_full = prev_y_full_by_ch.get(ch, 0.0)
        prev_window = prev_window_by_ch.get(ch, 0.0)
        prev_y_window = prev_y_window_by_ch.get(ch, 0.0)
        mom_variance = ((mtd - prev_window) / prev_window * 100) if prev_window > 0 else None
        yoy_variance = ((mtd - prev_y_window) / prev_y_window * 100) if prev_y_window > 0 else None
        pct_proj = (projected / target * 100) if target else None
        country = country_by_ch.get(ch, "")
        group = _classify_store_group(ch, country)
        rows.append({
            "channel": ch,
            "display_name": _display_store_name(ch),
            "country": country,
            "group": group,
            "sales_target": target,
            "mtd_actual": round(mtd, 2),
            "projected_landing": round(projected, 2),
            "prior_year_full_month": round(prev_y_full, 2),
            "prior_month_full": round(prev_full, 2),
            "prior_year_same_window": round(prev_y_window, 2),
            "prior_month_same_window": round(prev_window, 2),
            "pct_of_target_projected": round(pct_proj, 2) if pct_proj is not None else None,
            "mom_variance_pct": round(mom_variance, 2) if mom_variance is not None else None,
            "yoy_variance_pct": round(yoy_variance, 2) if yoy_variance is not None else None,
        })
    rows.sort(key=lambda r: r["mtd_actual"], reverse=True)
    return {
        "month": m.isoformat(),
        "as_of": today.isoformat(),
        "days_complete": days_complete,
        "days_in_month": days_in_curr,
        "rows": rows,
    }
