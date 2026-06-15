"""Iter 86b — Pre-computed `/orders` daily aggregates.

The dashboard's most expensive endpoints — walk-ins, churn, avg-spend
by customer type, customer frequency — all share the same pattern:

  1. Fan out `/orders` upstream in 14-day chunks per (country, channel).
  2. Iterate every line item to compute counts / sums.
  3. Throw the raw data away.

Per the upstream BI API team's cost analysis (May 2026), this fan-out
was driving ~12-18 upstream calls per Customers page load and the
single biggest chunk of their remaining BigQuery bill after Iter 86's
smart-TTL fix.

This module is the foundation of the fix:

  • `orders_daily_snapshots`            — per (date, country) day-level
                                          aggregates suitable for
                                          re-aggregating across any
                                          date window without re-
                                          calling `/orders`.
  • `customer_lifetime_roster`          — per customer cumulative
                                          info (first/last purchase,
                                          lifetime totals, name).
                                          Replaces the on-demand
                                          400-day `/top-customers`
                                          scan that was the single
                                          biggest repeat offender.

Both collections are populated by a daily writer hooked into the
snapshotter loop; their freshness is observable on
`/admin/cache-stats.snapshotter.daily_aggregates`.

DESIGN NOTES — read before extending:

  1. Idempotent writes. The writer upserts on `(date, country)` so the
     same day-country can be re-written safely if upstream returned a
     transient empty payload earlier. This is required because we WILL
     refresh today's snapshot multiple times per day.

  2. `country=None` means the All-Countries roll-up. We compute it by
     summing the per-country snapshots (cheap, ~5 ms) rather than
     calling `/orders` without a country filter — saves a redundant
     upstream call.

  3. Cardinality envelope. A busy day in Vivo's catalogue is ~600
     transactions per country (Kenya ≈ 400, Uganda ≈ 80, Rwanda ≈ 30,
     Online ≈ 100). That's ~600 line items per (date, country) doc,
     well under Mongo's 16 MB limit.

  4. The walk-in detection rule MUST match `_is_walk_in()` in
     server.py exactly — same flags, same case-insensitive checks,
     same store-name heuristics. We import it here rather than
     re-implement to guarantee parity. A regression test pins the
     equivalence (see test_iteration_86b_orders_aggregates.py).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────

def _yyyy_mm_dd(d) -> str:
    if isinstance(d, str):
        return d[:10]
    if isinstance(d, (date, datetime)):
        return d.isoformat()[:10]
    raise TypeError(f"unsupported date type: {type(d)}")


def _enum_days(date_from: str, date_to: str) -> List[str]:
    """Inclusive list of YYYY-MM-DD strings between `date_from` and
    `date_to`."""
    d1 = datetime.strptime(date_from, "%Y-%m-%d").date()
    d2 = datetime.strptime(date_to, "%Y-%m-%d").date()
    out = []
    cur = d1
    while cur <= d2:
        out.append(cur.isoformat())
        cur = cur + timedelta(days=1)
    return out


def _empty_location_agg() -> Dict[str, Any]:
    return {
        "total_orders": 0, "total_units": 0, "total_sales_kes": 0.0,
        "walk_in_orders": 0, "walk_in_units": 0, "walk_in_sales_kes": 0.0,
    }


def _empty_country_doc(d: str, country: str) -> Dict[str, Any]:
    return {
        "date": d,
        "country": country,
        "snapshot_at": datetime.now(timezone.utc),
        "total_orders": 0, "total_units": 0, "total_sales_kes": 0.0,
        "walk_in_orders": 0, "walk_in_units": 0, "walk_in_sales_kes": 0.0,
        "by_location": [],
        # `by_customer` is intentionally NOT precomputed here; downstream
        # endpoints that need per-customer detail (avg-spend, churn,
        # frequency) will be migrated in subsequent iterations and can
        # extend this schema then. Keeping the v1 doc lean avoids
        # ballooning the collection while we land walk-ins first.
    }


# ── Build a day-country doc from a raw /orders result ───────────────

def build_daily_doc(
    *,
    d: str,
    country: str,
    rows: List[Dict[str, Any]],
    is_walk_in_fn,
) -> Dict[str, Any]:
    """Reduce a list of /orders rows into one `orders_daily_snapshots`
    doc. `is_walk_in_fn(row, location_name)` returns True iff the row
    should count as a walk-in — passed in to keep this module decoupled
    from server.py.

    Aggregates to UNIQUE order_ids (upstream returns one row per line
    item; a 5-SKU walk-in order would otherwise be counted 5×).

    Iter 86d — Phase 2 schema extension. We now also write a
    `by_customer` array (one entry per unique customer_id in the day)
    so the avg-spend, churn, and frequency endpoints can read the
    aggregate without re-fanning out to `/orders`. The entry shape:
        {
          customer_id: str,
          customer_type: "New" | "Returning" | "",
          orders: int,           # de-dup'd within the day
          units: int,
          sales_kes: float,
          is_walk_in: bool,
        }
    customer_type uses the majority-vote rule with "Returning" winning
    ties — same as the legacy endpoint. Walk-in rows are included with
    is_walk_in=True; consumers filter them out or include them as
    needed.
    """
    doc = _empty_country_doc(d, country)
    # Track seen order_ids per location so we don't double-count.
    seen_orders_by_loc: Dict[str, set] = {}
    walk_orders_by_loc: Dict[str, set] = {}
    # Aggregated totals at country level dedup'd by order_id.
    seen_total: set = set()
    seen_walk: set = set()
    by_loc: Dict[Tuple[str, str], Dict[str, Any]] = {}
    # Per-customer accumulators (Iter 86d Phase 2).
    cust_orders_seen: Dict[str, set] = {}     # customer_id -> set of order_ids
    cust_sales: Dict[str, float] = {}
    cust_units: Dict[str, float] = {}
    cust_walkin: Dict[str, bool] = {}
    cust_type_votes: Dict[str, Dict[str, int]] = {}
    # Iter 91ac — Track distinct order_ids by customer_type even when
    # customer_id is missing. This rescues Shop Zetu orders where
    # upstream drops the customer_id but preserves customer_type =
    # "New"/"Returning". Used by `/customers` fallback to estimate
    # distinct identified-customer counts when the canonical
    # by_customer rollup is starved.
    new_orders_no_cid: set = set()
    returning_orders_no_cid: set = set()

    for r in rows:
        order_id = r.get("order_id") or r.get("id")
        if not order_id:
            continue
        oid = str(order_id)
        loc = (r.get("pos_location_name") or r.get("location_name") or "").strip()
        channel = (r.get("channel") or "").strip()
        key = (loc, channel)
        if key not in by_loc:
            by_loc[key] = _empty_location_agg()
            by_loc[key]["pos_location_name"] = loc
            by_loc[key]["channel"] = channel
            seen_orders_by_loc[loc] = set()
            walk_orders_by_loc[loc] = set()

        # Sales / units accumulate per LINE ITEM (matches the upstream
        # /kpis totals which sum line items, not orders).
        qty = float(r.get("quantity") or r.get("qty") or 0)
        sales = float(r.get("total_sales_kes") or r.get("total_sales") or r.get("net_sales") or 0)
        by_loc[key]["total_units"] += qty
        by_loc[key]["total_sales_kes"] += sales
        doc["total_units"] += qty
        doc["total_sales_kes"] += sales

        is_walkin = is_walk_in_fn(r, loc)
        if is_walkin:
            by_loc[key]["walk_in_units"] += qty
            by_loc[key]["walk_in_sales_kes"] += sales
            doc["walk_in_units"] += qty
            doc["walk_in_sales_kes"] += sales

        # Per-customer rollup. We intentionally include walk-ins here
        # (cid=""), so avg-spend can filter them out at read-time
        # while frequency / churn can still inspect them if needed.
        cid = str(r.get("customer_id") or "")
        ctype = (r.get("customer_type") or "").strip()
        # Iter 91ac — capture cid-less but tagged orders for fallback.
        if not cid and ctype in ("New", "Returning"):
            if ctype == "New":
                new_orders_no_cid.add(oid)
            else:
                returning_orders_no_cid.add(oid)
        if cid not in cust_orders_seen:
            cust_orders_seen[cid] = set()
            cust_sales[cid] = 0.0
            cust_units[cid] = 0.0
            cust_walkin[cid] = False
            cust_type_votes[cid] = {"New": 0, "Returning": 0}
        cust_orders_seen[cid].add(oid)
        cust_sales[cid] += sales
        cust_units[cid] += qty
        if is_walkin:
            cust_walkin[cid] = True
        if ctype in ("New", "Returning"):
            cust_type_votes[cid][ctype] += 1

        # Unique-order counts.
        if oid not in seen_total:
            seen_total.add(oid)
            doc["total_orders"] += 1
        if oid not in seen_orders_by_loc[loc]:
            seen_orders_by_loc[loc].add(oid)
            by_loc[key]["total_orders"] += 1
        if is_walkin:
            if oid not in seen_walk:
                seen_walk.add(oid)
                doc["walk_in_orders"] += 1
            if oid not in walk_orders_by_loc[loc]:
                walk_orders_by_loc[loc].add(oid)
                by_loc[key]["walk_in_orders"] += 1

    doc["total_sales_kes"] = round(doc["total_sales_kes"], 2)
    doc["walk_in_sales_kes"] = round(doc["walk_in_sales_kes"], 2)
    for v in by_loc.values():
        v["total_sales_kes"] = round(v["total_sales_kes"], 2)
        v["walk_in_sales_kes"] = round(v["walk_in_sales_kes"], 2)
    doc["by_location"] = list(by_loc.values())

    # Materialise per-customer rollup. Skip the cid="" bucket — its
    # data is already in walk_in_* totals and storing it would just
    # bloat the doc with a 0-customer-id key.
    by_cust = []
    for cid, order_set in cust_orders_seen.items():
        if not cid:
            continue
        votes = cust_type_votes[cid]
        # Returning wins ties (same rule as legacy avg-spend endpoint).
        ctype = "New" if votes["New"] > votes["Returning"] else "Returning"
        by_cust.append({
            "customer_id": cid,
            "customer_type": ctype,
            "orders": len(order_set),
            "units": int(cust_units[cid]),
            "sales_kes": round(cust_sales[cid], 2),
            "is_walk_in": cust_walkin[cid],
        })
    doc["by_customer"] = by_cust
    # Iter 91ac — Side-channel counts for orders tagged with a
    # customer_type but missing customer_id (upstream pipeline bug).
    # Each set member is a distinct order_id.
    doc["identified_new_orders_no_cid"] = len(new_orders_no_cid)
    doc["identified_returning_orders_no_cid"] = len(returning_orders_no_cid)
    return doc


# ── Aggregate read — used by /customers/walk-ins ────────────────────

async def read_walkins_aggregate(
    db,
    *,
    date_from: str,
    date_to: str,
    countries: Optional[List[str]],
    channels: Optional[List[str]],
) -> Optional[Dict[str, Any]]:
    """Read the pre-computed walk-ins payload for the requested window.

    Returns `None` if ANY day in the window is missing from the
    `orders_daily_snapshots` collection — caller falls back to the
    live `/orders` fan-out path so we never silently serve a partial
    answer.

    If a `countries` filter is given, only those rows are included.
    `channels` filters the by_location entries (does not split the
    country aggregate — the channel was always reported by location
    in the original implementation).
    """
    days = _enum_days(date_from, date_to)
    # Iter 88s (2026-05-27) — channel-group fast-path.
    # The daily snapshot collection is country-level grain, so it can't
    # honour an arbitrary list of POS-channel names. The Customers page
    # FilterBar exposes a 3-state channel group: "all" (no channels),
    # "retail" (every POS that ISN'T "Online - Shop Zetu"), and "online"
    # (just Online). We can serve all 3 from the country-level snapshot:
    #   • "all"      → no channels list → use every country row
    #   • "online"   → channels list looks like ["Online - Shop Zetu"]
    #   • "retail"   → the inverse → exclude the Online country row
    # If the caller passes a `channels` list that contains anything
    # OTHER than the magic "online" POS name, we treat it as the retail
    # channel group (excluding Online) at country grain.
    online_only = False
    retail_only = False
    if channels:
        ch_set = {(c or "").strip().lower() for c in channels if c}
        def _is_online_label(lbl: str) -> bool:
            return "online" in lbl or "shop zetu" in lbl
        if all(_is_online_label(c) for c in ch_set):
            online_only = True
        elif all(not _is_online_label(c) for c in ch_set):
            retail_only = True
        else:
            return None
    # We always want the per-country docs (NOT the None roll-up) so we
    # can sum + filter consistently. The None roll-up is a derivation,
    # not a stored doc.
    real_countries = ["Kenya", "Uganda", "Rwanda", "Online"]
    query = {"date": {"$in": days}, "country": {"$in": real_countries}}
    cursor = db.orders_daily_snapshots.find(query, {"_id": 0})
    rows = await cursor.to_list(length=None)
    # Coverage check: every (day × country) we wanted must be present.
    have_keys = {(r["date"], r["country"]) for r in rows}
    want_keys = {(d, c) for d in days for c in real_countries}
    missing = want_keys - have_keys
    if missing:
        logger.info(
            "[orders-aggregates] walk-ins: %d/%d (day×country) missing — "
            "falling through to live path. e.g. %s",
            len(missing), len(want_keys), next(iter(missing)),
        )
        return None

    # Country-level totals (post-filter).
    if countries:
        cs_set = {c for c in countries if c}
        rows = [r for r in rows if r["country"] in cs_set]

    # Iter 88s — channel-group filter applied at country grain.
    if online_only:
        rows = [r for r in rows if r["country"] == "Online"]
    elif retail_only:
        rows = [r for r in rows if r["country"] != "Online"]

    walk_orders = sum(r.get("walk_in_orders", 0) for r in rows)
    walk_units = sum(r.get("walk_in_units", 0) for r in rows)
    walk_sales = sum(r.get("walk_in_sales_kes", 0) for r in rows)
    total_orders = sum(r.get("total_orders", 0) for r in rows)
    total_sales = sum(r.get("total_sales_kes", 0) for r in rows)

    # By country breakdown.
    by_country: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        c = r["country"]
        bc = by_country.setdefault(c, {
            "country": c,
            "walk_in_orders": 0, "walk_in_units": 0, "walk_in_sales": 0.0,
            "total_orders": 0, "total_sales": 0.0,
        })
        bc["walk_in_orders"] += r.get("walk_in_orders", 0)
        bc["walk_in_units"] += r.get("walk_in_units", 0)
        bc["walk_in_sales"] += r.get("walk_in_sales_kes", 0)
        bc["total_orders"] += r.get("total_orders", 0)
        bc["total_sales"] += r.get("total_sales_kes", 0)
    by_country_out = []
    for c, bc in sorted(by_country.items()):
        bc["walk_in_share_orders_pct"] = round(
            (bc["walk_in_orders"] / bc["total_orders"] * 100), 2,
        ) if bc["total_orders"] else 0.0
        bc["walk_in_share_sales_pct"] = round(
            (bc["walk_in_sales"] / bc["total_sales"] * 100), 2,
        ) if bc["total_sales"] else 0.0
        bc["walk_in_avg_basket_kes"] = round(
            (bc["walk_in_sales"] / bc["walk_in_orders"]), 2,
        ) if bc["walk_in_orders"] else 0.0
        bc["walk_in_sales"] = round(bc["walk_in_sales"], 2)
        bc["total_sales"] = round(bc["total_sales"], 2)
        # Iter 87 — alias walk_in_customers = walk_in_orders per spec
        # (each anonymous transaction = 1 walk-in customer).
        bc["walk_in_customers"] = bc["walk_in_orders"]
        by_country_out.append(bc)

    # By location breakdown — aggregate across days for the same loc.
    by_loc: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in rows:
        for loc in r.get("by_location", []):
            ln = (loc.get("pos_location_name") or "").strip()
            ch = (loc.get("channel") or "").strip()
            if channels:
                if ch not in set(channels):
                    continue
            key = (ln, ch)
            agg = by_loc.setdefault(key, {
                "pos_location_name": ln, "channel": ch,
                "walk_in_orders": 0, "walk_in_units": 0, "walk_in_sales": 0.0,
                "total_orders": 0, "total_sales": 0.0,
            })
            agg["walk_in_orders"] += loc.get("walk_in_orders", 0)
            agg["walk_in_units"] += loc.get("walk_in_units", 0)
            agg["walk_in_sales"] += loc.get("walk_in_sales_kes", 0)
            agg["total_orders"] += loc.get("total_orders", 0)
            agg["total_sales"] += loc.get("total_sales_kes", 0)
    by_loc_out = []
    for v in by_loc.values():
        v["walk_in_share_orders_pct"] = round(
            (v["walk_in_orders"] / v["total_orders"] * 100), 2,
        ) if v["total_orders"] else 0.0
        v["walk_in_share_sales_pct"] = round(
            (v["walk_in_sales"] / v["total_sales"] * 100), 2,
        ) if v["total_sales"] else 0.0
        v["walk_in_avg_basket_kes"] = round(
            (v["walk_in_sales"] / v["walk_in_orders"]), 2,
        ) if v["walk_in_orders"] else 0.0
        v["walk_in_sales"] = round(v["walk_in_sales"], 2)
        v["total_sales"] = round(v["total_sales"], 2)
        # Iter 87 — alias walk_in_customers (= walk_in_orders per spec).
        v["walk_in_customers"] = v["walk_in_orders"]
        # Also expose capture_rate_pct so the FE doesn't need to derive
        # it (consistent shape between fast-path + slow-path).
        v["capture_rate_pct"] = round(100.0 - v["walk_in_share_orders_pct"], 2) if v["total_orders"] else None
        # Surface `channel` alias as the by_location renderer expects it.
        if not v.get("channel"):
            v["channel"] = v.get("pos_location_name", "")
        by_loc_out.append(v)
    by_loc_out.sort(key=lambda x: x["walk_in_orders"], reverse=True)

    return {
        "walk_in_orders": int(walk_orders),
        # Iter 87 — alias for clarity: each walk-in transaction = 1
        # walk-in customer (10 anonymous orders at a store = 10 walk-in
        # customers).
        "walk_in_customers": int(walk_orders),
        "walk_in_units": int(walk_units),
        "walk_in_sales_kes": round(walk_sales, 2),
        "walk_in_avg_basket_kes": round((walk_sales / walk_orders), 2) if walk_orders else 0.0,
        "total_orders": int(total_orders),
        "total_sales_kes": round(total_sales, 2),
        "walk_in_share_orders_pct": round((walk_orders / total_orders * 100), 2) if total_orders else 0.0,
        "walk_in_share_sales_pct": round((walk_sales / total_sales * 100), 2) if total_sales else 0.0,
        "by_country": by_country_out,
        "by_location": by_loc_out,
        "detection_rule": (
            "customer_id NULL · customer_type Guest/Walk-in/Anonymous · "
            "customer in roster with BLANK name (~379 IDs) · "
            "customer_name contains 'walk'/'vivo'/'safari'/store name"
        ),
        "truncated": False,
        "degraded": False,
        "source": "mongo_aggregate",
    }


# ── Iter 86d Phase 2 — Avg-spend by customer type, served from agg ──

async def read_avg_spend_aggregate(
    db,
    *,
    date_from: str,
    date_to: str,
    countries: Optional[List[str]],
    channels: Optional[List[str]],
) -> Optional[Dict[str, Any]]:
    """Aggregate the per-customer rollup in `orders_daily_snapshots`
    into the same shape the legacy `analytics_avg_spend_by_customer_type`
    endpoint returned. Excludes walk-ins from both buckets (denominator
    + numerator) — same rule as the legacy live path.

    Coverage check: returns None if any (day × country) is missing, so
    the caller can fall through to the live `/orders` path. After the
    Phase 5 90-day backfill ships, this fast-path will hit ~100% of
    requests.

    Channels filter is currently a no-op on this read — the legacy
    endpoint also ignored channel-by-channel splits for avg-spend (the
    metric is most useful at country level). We accept the param for
    API symmetry; if channel filtering is needed later we can extend
    the per-customer entry to carry pos_location_name and partition.
    """
    days = _enum_days(date_from, date_to)
    real_countries = ["Kenya", "Uganda", "Rwanda", "Online"]
    query = {"date": {"$in": days}, "country": {"$in": real_countries}}
    cursor = db.orders_daily_snapshots.find(query, {"_id": 0})
    rows = await cursor.to_list(length=None)
    have = {(r["date"], r["country"]) for r in rows}
    want = {(d, c) for d in days for c in real_countries}
    if want - have:
        return None
    if countries:
        cs_set = {c for c in countries if c}
        rows = [r for r in rows if r["country"] in cs_set]

    # Roll up per customer across the window.
    cust_spend: Dict[str, float] = {}
    cust_orders: Dict[str, int] = {}
    cust_units: Dict[str, int] = {}
    cust_type_votes: Dict[str, Dict[str, int]] = {}
    for r in rows:
        for c in (r.get("by_customer") or []):
            if c.get("is_walk_in"):
                continue
            cid = c.get("customer_id")
            if not cid:
                continue
            cust_spend[cid] = cust_spend.get(cid, 0.0) + float(c.get("sales_kes") or 0)
            cust_orders[cid] = cust_orders.get(cid, 0) + int(c.get("orders") or 0)
            cust_units[cid] = cust_units.get(cid, 0) + int(c.get("units") or 0)
            ct = c.get("customer_type") or "Returning"
            v = cust_type_votes.setdefault(cid, {"New": 0, "Returning": 0})
            if ct in v:
                v[ct] += 1

    if not cust_spend:
        empty = {"customers": 0, "orders": 0, "total_spend_kes": 0,
                 "avg_spend_per_customer_kes": 0, "avg_orders_per_customer": 0,
                 "avg_basket_value_kes": 0}
        return {"new": empty, "returning": dict(empty), "source": "mongo_aggregate"}

    new_spend = ret_spend = 0.0
    new_count = ret_count = 0
    new_orders = ret_orders = 0
    for cid, spend in cust_spend.items():
        votes = cust_type_votes.get(cid) or {"New": 0, "Returning": 0}
        is_new = votes["New"] > votes["Returning"]
        if is_new:
            new_spend += spend
            new_count += 1
            new_orders += cust_orders[cid]
        else:
            ret_spend += spend
            ret_count += 1
            ret_orders += cust_orders[cid]

    def _bucket(spend, count, orders):
        return {
            "customers": count,
            "orders": orders,
            "total_spend_kes": round(spend, 2),
            "avg_spend_per_customer_kes": round(spend / count, 2) if count else 0,
            "avg_orders_per_customer": round(orders / count, 2) if count else 0,
            "avg_basket_value_kes": round(spend / orders, 2) if orders else 0,
        }

    return {
        "new": _bucket(new_spend, new_count, new_orders),
        "returning": _bucket(ret_spend, ret_count, ret_orders),
        "source": "mongo_aggregate",
    }


# ── Customer lifetime roster ────────────────────────────────────────

def build_customer_lifetime_doc(row: Dict[str, Any]) -> Dict[str, Any]:
    """Convert one /top-customers row (lifetime) into a roster doc.

    The roster is the daily-built replacement for the on-demand 400-day
    `/top-customers?limit=200000` scan. Each refresh writes one doc per
    customer with: name, first/last purchase date, lifetime totals,
    contact-info presence.
    """
    cid = str(row.get("customer_id") or "").strip()
    name = (row.get("customer_name") or "").strip()
    phone = row.get("phone") or row.get("customer_phone")
    email = row.get("email") or row.get("customer_email")
    return {
        "customer_id": cid,
        "customer_name": name,
        "first_purchase_date": (row.get("first_purchase_date") or "")[:10] or None,
        "last_purchase_date": (row.get("last_purchase_date") or "")[:10] or None,
        "lifetime_orders": int(row.get("orders") or row.get("order_count") or 0),
        "lifetime_units": int(row.get("units") or row.get("quantity") or 0),
        "lifetime_sales_kes": float(row.get("total_sales_kes") or row.get("total_sales") or 0),
        "has_phone": bool(phone and str(phone).strip()),
        "has_email": bool(email and str(email).strip()),
        "country": (row.get("country") or "").strip() or None,
        "snapshot_at": datetime.now(timezone.utc),
    }


async def read_customer_name_lookup(db) -> Tuple[Dict[str, str], Dict[str, Dict[str, bool]]]:
    """Read the name + contact lookup from the lifetime roster.

    Returns (id→name, id→{has_phone, has_email}). Falls back to ({}, {})
    if the roster hasn't been populated yet — caller should then warm
    via the live `/top-customers` path. After Iter 86b ships, the live
    path becomes the exception, not the rule.
    """
    cursor = db.customer_lifetime_roster.find(
        {},
        {"_id": 0, "customer_id": 1, "customer_name": 1,
         "has_phone": 1, "has_email": 1},
    )
    name_map: Dict[str, str] = {}
    contact_map: Dict[str, Dict[str, bool]] = {}
    async for r in cursor:
        cid = r.get("customer_id")
        if not cid:
            continue
        name_map[cid] = r.get("customer_name") or ""
        contact_map[cid] = {
            "has_phone": bool(r.get("has_phone")),
            "has_email": bool(r.get("has_email")),
        }
    return name_map, contact_map
