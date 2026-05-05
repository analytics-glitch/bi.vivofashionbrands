"""Customer-analytics endpoints — extracted from server.py during the
2026-04-30 refactor pass.

These four endpoints power the Customer Details page and the
"unchurned / spend by type / retention rate" cards on the Customers
dashboard. They were grouped together because they all:

  • share the ``_orders_for_window`` upstream cache,
  • exclude walk-ins via ``_is_walk_in_order``, and
  • return PII that must be ``mask_rows``-filtered.

Endpoints:
  GET /api/analytics/customer-details
  GET /api/analytics/customer-retention
  GET /api/analytics/avg-spend-by-customer-type
  GET /api/analytics/recently-unchurned
"""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, Query

# Late imports — server.py imports this module AFTER its helpers exist.
from server import (
    api_router,
    _orders_for_window,
    _is_walk_in_order,
    _get_customer_name_lookup,
    _get_customer_contact_lookup_sync,
    _safe_fetch,
    _split_csv,
    category_of,
    logger,
)
from auth import get_current_user
from pii import mask_rows


# ─── /analytics/customer-details ──────────────────────────────────────
@api_router.get("/analytics/customer-details")
async def analytics_customer_details(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    category: Optional[str] = None,  # CSV of merch categories
    subcategory: Optional[str] = None,  # CSV of merch subcategories
    limit: int = Query(500, ge=1, le=5000),
    user=Depends(get_current_user),
):
    """Customer details list — one row per identified customer with basic
    contact info, lifetime stats inside the window, and first / last
    order dates. Powers the new Customer Details page.

    Filters:
      • country  — single or CSV (Title-cased upstream)
      • channel  — POS location, single or CSV
      • category / subcategory — merchandise filters; an order counts
        toward the customer if ANY of its line items match.

    The upstream BI doesn't expose SMS / email marketing-consent flags,
    so those columns will come back as null and the UI shows them as
    "n/a" — we explicitly do NOT fabricate consent values.

    Walk-ins (no customer_id) are excluded.
    """
    rows = await _orders_for_window(date_from, date_to, country, channel)
    # Warm the customer-name + contact lookup so the walk-in detector
    # can fire its name-pattern + no-phone-no-email rules.
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _get_customer_contact_lookup_sync()

    # Optional category / subcategory filter — applied per /orders row.
    cat_set = set(_split_csv(category)) if category else None
    sub_set = set(_split_csv(subcategory)) if subcategory else None
    chs_set = set(_split_csv(channel)) if channel else None

    by_cust: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            continue
        cid = str(r.get("customer_id") or "")
        if not cid:
            continue
        # Channel / POS filter (when CSV — single value already filtered upstream).
        if chs_set:
            chan = r.get("channel") or r.get("pos_location_name") or ""
            if chan not in chs_set:
                continue
        # Merch filter — order qualifies if its subcategory matches.
        sub = r.get("subcategory") or r.get("product_type") or ""
        if sub_set and sub not in sub_set:
            continue
        if cat_set and category_of(sub) not in cat_set:
            continue
        agg = by_cust.setdefault(cid, {
            "customer_id": cid,
            "customer_name": r.get("customer_name") or "",
            "email": r.get("customer_email") or "",
            "mobile": r.get("customer_phone") or r.get("phone") or "",
            "country": r.get("country") or r.get("customer_country") or "",
            "first_order_date": "",
            "last_order_date": "",
            "total_orders": 0,
            "total_units": 0,
            "total_sales": 0.0,
            "_order_ids": set(),
        })
        # Backfill name/email/mobile if upstream omitted earlier rows.
        if not agg["customer_name"] and r.get("customer_name"):
            agg["customer_name"] = r["customer_name"]
        if not agg["email"] and r.get("customer_email"):
            agg["email"] = r["customer_email"]
        if not agg["mobile"] and (r.get("customer_phone") or r.get("phone")):
            agg["mobile"] = r.get("customer_phone") or r.get("phone")
        od = (r.get("order_date") or "")[:10]
        if od:
            if not agg["first_order_date"] or od < agg["first_order_date"]:
                agg["first_order_date"] = od
            if not agg["last_order_date"] or od > agg["last_order_date"]:
                agg["last_order_date"] = od
        oid = r.get("order_id")
        if oid:
            agg["_order_ids"].add(oid)
        agg["total_units"] += int(r.get("quantity") or 0)
        agg["total_sales"] += float(r.get("net_sales_kes") or r.get("total_sales_kes") or 0)

    out: List[Dict[str, Any]] = []
    for agg in by_cust.values():
        agg["total_orders"] = len(agg.pop("_order_ids", set()))
        agg["total_sales"] = round(agg["total_sales"], 2)
        out.append(agg)

    out.sort(key=lambda x: x["total_sales"], reverse=True)
    out = out[:limit]

    # Enrich with name / phone / email from /top-customers (upstream's only
    # source for these — /orders doesn't carry customer_name). Pull a
    # generous limit so we cover the visible IDs; this is one cached call.
    try:
        top = await _safe_fetch("/top-customers", {
            "date_from": date_from, "date_to": date_to,
            "country": _split_csv(country)[0] if country and "," not in country else None,
            "limit": 5000,
        }) or []
        by_id = {str(r.get("customer_id") or ""): r for r in top}
        for agg in out:
            tc = by_id.get(agg["customer_id"])
            if tc:
                if not agg["customer_name"] and tc.get("customer_name"):
                    agg["customer_name"] = tc["customer_name"]
                if not agg["email"] and tc.get("email"):
                    agg["email"] = tc["email"]
                if not agg["mobile"] and tc.get("phone"):
                    agg["mobile"] = tc["phone"]
                if not agg["country"] and tc.get("customer_country"):
                    agg["country"] = tc["customer_country"]
    except Exception as e:
        logger.warning("[/analytics/customer-details] top-customers enrichment failed: %s", e)

    # Best-effort first / last name split + consent placeholders.
    for agg in out:
        full = (agg["customer_name"] or "").strip()
        parts = full.split() if full else []
        agg["first_name"] = parts[0] if parts else ""
        agg["last_name"] = " ".join(parts[1:]) if len(parts) > 1 else ""
        agg["accepts_sms_marketing"] = None
        agg["accepts_email_marketing"] = None

    return mask_rows(out, getattr(user, "role", None))


# ─── /analytics/customer-retention ────────────────────────────────────
@api_router.get("/analytics/customer-retention")
async def analytics_customer_retention(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Identified-customer retention metrics.

    Excludes walk-ins (no customer_id OR customer_type=Guest) — they
    can't be tracked across orders so they shouldn't dilute retention.

    Returns:
      • total_customers — distinct customer_id seen in window
      • repeat_customers — customer_id with ≥2 orders in window
      • vip_customers — customer_id with ≥5 orders in window
      • repeat_rate_pct — repeat / total × 100
      • avg_orders_per_returner — orders ÷ customers (for repeaters only)
      • walk_in_orders — orders excluded
    """
    rows = await _orders_for_window(date_from, date_to, country, channel)
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _get_customer_contact_lookup_sync()
    # Count DISTINCT (order_date, channel) pairs per customer — not raw
    # order_ids and not line items. A customer who buys twice in a single
    # store on the same day = 1 visit; same day but different stores = 2;
    # different days = 2. /orders is line-item-grained so we collapse
    # same-day-same-channel rows into one visit before counting.
    by_cust: Dict[str, set] = {}
    walk_ins = 0
    for r in rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            walk_ins += 1
            continue
        cid = r.get("customer_id")
        if cid is None:
            continue
        day = (r.get("order_date") or "")[:10]
        chan = r.get("channel") or r.get("pos_location_name") or ""
        if not day:
            continue
        by_cust.setdefault(str(cid), set()).add((day, chan))
    order_counts = {cid: len(visits) for cid, visits in by_cust.items()}
    total = len(order_counts)
    repeat = sum(1 for n in order_counts.values() if n >= 2)
    vip = sum(1 for n in order_counts.values() if n >= 5)
    returner_orders = sum(n for n in order_counts.values() if n >= 2)
    avg_orders_per_returner = (returner_orders / repeat) if repeat else 0
    return {
        "total_customers": total,
        "repeat_customers": repeat,
        "vip_customers": vip,
        "repeat_rate_pct": (repeat / total * 100) if total else 0,
        "avg_orders_per_returner": round(avg_orders_per_returner, 2),
        "walk_in_orders": walk_ins,
    }


# ─── /analytics/avg-spend-by-customer-type ────────────────────────────
def _empty_spend_bucket() -> Dict[str, Any]:
    return {"customers": 0, "orders": 0, "total_spend_kes": 0,
            "avg_spend_per_customer_kes": 0, "avg_orders_per_customer": 0}


@api_router.get("/analytics/avg-spend-by-customer-type")
async def analytics_avg_spend_by_customer_type(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Avg spend per customer split by New vs Returning.

    Uses upstream `customer_type` field directly (values "New" / "Returning"
    / "Guest"). A customer's classification can shift inside the window —
    we count each customer ONCE per bucket (their majority type, with
    "Returning" winning ties). Walk-ins (customer_type=Guest OR no
    customer_id) are excluded.
    """
    rows = await _orders_for_window(date_from, date_to, country, channel)
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _get_customer_contact_lookup_sync()

    # Per-customer aggregates: spend, order count, type vote.
    spend_by_cust: Dict[str, float] = defaultdict(float)
    orders_by_cust: Dict[str, int] = defaultdict(int)
    type_votes: Dict[str, Dict[str, int]] = defaultdict(lambda: {"New": 0, "Returning": 0})
    for r in rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            continue
        cid = str(r.get("customer_id") or "")
        if not cid:
            continue
        ctype = (r.get("customer_type") or "").strip()
        if ctype not in ("New", "Returning"):
            # Default unknowns to "Returning" — safer; under-counts new.
            ctype = "Returning"
        spend_by_cust[cid] += float(r.get("net_sales_kes") or r.get("total_sales_kes") or 0)
        orders_by_cust[cid] += 1
        type_votes[cid][ctype] += 1

    if not spend_by_cust:
        return {"new": _empty_spend_bucket(), "returning": _empty_spend_bucket()}

    new_spend = 0.0
    new_count = 0
    new_orders = 0
    ret_spend = 0.0
    ret_count = 0
    ret_orders = 0
    for cid, spend in spend_by_cust.items():
        votes = type_votes[cid]
        # "Returning" wins ties — once a customer is returning, they stay.
        is_new = votes["New"] > votes["Returning"]
        if is_new:
            new_spend += spend
            new_count += 1
            new_orders += orders_by_cust[cid]
        else:
            ret_spend += spend
            ret_count += 1
            ret_orders += orders_by_cust[cid]

    def _bucket(spend, count, orders):
        return {
            "customers": count,
            "orders": orders,
            "total_spend_kes": round(spend, 2),
            "avg_spend_per_customer_kes": round(spend / count, 2) if count else 0,
            "avg_orders_per_customer": round(orders / count, 2) if count else 0,
        }

    return {"new": _bucket(new_spend, new_count, new_orders),
            "returning": _bucket(ret_spend, ret_count, ret_orders)}


# ─── /analytics/recently-unchurned ────────────────────────────────────
@api_router.get("/analytics/recently-unchurned")
async def analytics_recently_unchurned(
    date_from: str,
    date_to: str,
    min_gap_days: int = Query(90, ge=7, le=365),
    country: Optional[str] = None,
    channel: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Customers whose gap between their LAST TWO visits is ≥ `min_gap_days`
    AND whose latest visit falls inside [date_from, date_to].

    "Recently unchurned" = a customer who came back after a long silence.
    Useful for win-back campaigns: they just proved they still respond,
    so a follow-up nudge has high conversion. Reasonable thresholds: 30,
    60, 90, 180 days (frontend slider).

    Look-back window: dynamic — we look back `min_gap_days + 30` days
    so we always have enough history to detect the requested gap, but
    avoid the cost of a full year of /orders chunks. Walk-ins excluded.
    Output is masked by role like the other PII endpoints.

    Returns: list of {customer_id, customer_name, last_order_date,
    prev_order_date, gap_days, total_orders_window, total_spend_kes_window}.
    """
    today = datetime.strptime(date_to, "%Y-%m-%d").date()
    # Just enough history to spot the requested gap plus a 30-day buffer.
    look_from = (today - timedelta(days=min_gap_days + 30)).isoformat()
    hist_rows = await _orders_for_window(look_from, date_to, country, channel)
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _get_customer_contact_lookup_sync()

    # Bucket orders by customer_id, drop walk-ins.
    by_cust: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in hist_rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            continue
        cid = str(r.get("customer_id") or "")
        if not cid:
            continue
        by_cust[cid].append(r)

    out: List[Dict[str, Any]] = []
    for cid, orders in by_cust.items():
        # Order events by date — collapse same-day orders into one "visit"
        # since we want gaps between trips, not gaps between line-items.
        visit_dates = sorted({(o.get("order_date") or "")[:10] for o in orders if o.get("order_date")})
        if len(visit_dates) < 2:
            continue
        last = visit_dates[-1]
        prev = visit_dates[-2]
        # Latest visit must be in the requested window — otherwise the
        # customer's "comeback" happened before this period.
        if not (date_from <= last <= date_to):
            continue
        try:
            gap = (datetime.strptime(last, "%Y-%m-%d").date() -
                   datetime.strptime(prev, "%Y-%m-%d").date()).days
        except Exception:
            continue
        if gap < min_gap_days:
            continue
        # Window aggregates (orders & spend during the requested window).
        win_orders = [o for o in orders if date_from <= (o.get("order_date") or "")[:10] <= date_to]
        spend = sum(float(o.get("net_sales_kes") or o.get("total_sales_kes") or 0) for o in win_orders)
        sample = orders[-1]
        out.append({
            "customer_id": cid,
            "customer_name": sample.get("customer_name") or "",
            "customer_email": sample.get("customer_email") or "",
            "last_order_date": last,
            "prev_order_date": prev,
            "gap_days": gap,
            "total_orders_window": len(win_orders),
            "total_spend_kes_window": round(spend, 2),
        })
    out.sort(key=lambda x: x["gap_days"], reverse=True)
    return mask_rows(out, getattr(user, "role", None))


# ─── /analytics/repeat-customers ──────────────────────────────────────
@api_router.get("/analytics/repeat-customers")
async def analytics_repeat_customers(
    date_from: str,
    date_to: str,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    min_orders: int = Query(2, ge=1, le=50),
    user=Depends(get_current_user),
):
    """List of identified customers with ≥ `min_orders` distinct VISITS in
    the selected window. A "visit" is a unique (order_date, channel)
    pair — multiple order_ids generated in the same store on the same
    day collapse into one visit per the ops definition.

    Returns one row per customer with a nested `orders` list of visits
    (each carrying its rolled-up `order_id` list, total_kes, units, and
    POS channel) so the UI can drill in.

    Walk-ins excluded via the same robust 7-rule detector used elsewhere.
    Output is masked by role like the other PII endpoints.
    """
    rows = await _orders_for_window(date_from, date_to, country, channel)
    name_lookup = await _get_customer_name_lookup()
    contact_lookup = _get_customer_contact_lookup_sync()

    # Aggregate per (customer, date, channel): collapse line items into a
    # single visit total and collect every order_id that touched it. Carry
    # the customer's contact / name fields from whichever row has them.
    by_cust: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if _is_walk_in_order(r, name_lookup, contact_lookup):
            continue
        cid = r.get("customer_id")
        if cid is None:
            continue
        day = (r.get("order_date") or "")[:10]
        chan = r.get("channel") or r.get("pos_location_name") or ""
        if not day:
            continue
        cid_s = str(cid)
        cust = by_cust.setdefault(cid_s, {
            "customer_id": cid_s,
            "customer_name": r.get("customer_name") or name_lookup.get(cid_s, "") or "",
            "email": r.get("customer_email") or "",
            "mobile": r.get("customer_phone") or r.get("phone") or "",
            "country": r.get("country") or r.get("customer_country") or "",
            "_visits": {},
        })
        if not cust["customer_name"] and r.get("customer_name"):
            cust["customer_name"] = r["customer_name"]
        if not cust["email"] and r.get("customer_email"):
            cust["email"] = r["customer_email"]
        if not cust["mobile"] and (r.get("customer_phone") or r.get("phone")):
            cust["mobile"] = r.get("customer_phone") or r.get("phone")
        visit_key = (day, chan)
        visit = cust["_visits"].setdefault(visit_key, {
            "order_date": day,
            "channel": chan,
            "order_ids": set(),
            "total_kes": 0.0,
            "units": 0,
        })
        oid = r.get("order_id")
        if oid is not None:
            visit["order_ids"].add(str(oid))
        visit["total_kes"] += float(r.get("net_sales_kes") or r.get("total_sales_kes") or 0)
        visit["units"] += int(r.get("quantity") or 0)

    out: List[Dict[str, Any]] = []
    for cust in by_cust.values():
        visits = list(cust.pop("_visits").values())
        if len(visits) < min_orders:
            continue
        visits.sort(key=lambda v: v["order_date"], reverse=True)
        for v in visits:
            ids = sorted(v.pop("order_ids"))
            # Surface the rolled-up id list as a comma-joined `order_id`
            # field for the table, plus a count for the badge in the UI.
            v["order_id"] = ", ".join(ids) if ids else ""
            v["order_id_count"] = len(ids)
            v["total_kes"] = round(v["total_kes"], 2)
        cust["orders"] = visits  # field name kept as `orders` for FE compat
        cust["order_count"] = len(visits)
        cust["total_spend_kes"] = round(sum(v["total_kes"] for v in visits), 2)
        cust["first_order_date"] = min(v["order_date"] for v in visits) if visits else ""
        cust["last_order_date"] = max(v["order_date"] for v in visits) if visits else ""
        out.append(cust)

    out.sort(key=lambda c: (c["order_count"], c["total_spend_kes"]), reverse=True)
    return mask_rows(out, getattr(user, "role", None))
