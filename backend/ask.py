"""
Ask-anything natural-language search.

Lets users type free-form questions like "stores with stuck stock over
50%" or "customers who haven't bought in 90 days" into the ⌘K palette
and get direct rows + a deep-link back into the relevant dashboard.

Flow
----
1. LLM (claude-sonnet-4-5 via emergentintegrations) classifies the
   question into a small, closed intent vocabulary and extracts filter
   parameters as JSON.
2. Based on the intent, we call the appropriate existing analytics
   endpoint and apply the LLM-extracted filters server-side.
3. Response includes a short natural answer, rows (truncated), and a
   deep-link that applies the same filters on the destination page.

Intents (closed set — anything else returns intent="unknown")
    sell_through   — sell-through by location, filterable by health/pct
    stock_aging    — weeks-of-cover, filterable by bucket or WoH range
    pricing        — price changes, filterable by direction/|Δ|
    customers      — top customers, filterable by absent days
    stores         — stores ranked by a metric (sales/footfall/CR)
    reorder        — reorder suggestions, filterable by urgency
    page           — pure navigation, no rows
    unknown        — out-of-scope

Why a closed set? Keeps latency low (one LLM call, no tool-calling
loop), eliminates hallucinated endpoint names, and makes it trivial
to add new intents when the underlying dashboard gains new pages.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, HTTPException

from auth import get_current_user, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])


# ─── LLM system prompt ──────────────────────────────────────────────

SYSTEM_PROMPT = """You translate short retail BI questions into a compact JSON intent object. Vivo Fashion Group sells apparel in Kenya, Uganda, Rwanda.

Output EXACTLY this JSON shape (no prose, no markdown fences):

{
  "intent": "sell_through" | "stock_aging" | "pricing" | "customers" | "stores" | "reorder" | "page" | "unknown",
  "filters": { ... see below ... },
  "answer": "one short sentence (<=160 chars) summarising what the data should show",
  "page_label": null
}

Filter shapes per intent:

sell_through:   { "health_in": ["strong"|"healthy"|"slow"|"stuck"]?, "min_pct": <number>?, "max_pct": <number>?, "top_n": <1-20>? }
stock_aging:    { "buckets": ["fresh"|"healthy"|"aging"|"stale"|"phantom"]?, "min_woh": <number>?, "max_woh": <number>?, "top_n": <1-20>? }
pricing:        { "direction": "increase"|"decrease"?, "min_change_pct": <number>?, "top_n": <1-20>? }
customers:      { "mode": "top"|"absent"|"new", "days_absent_min": <int>?, "top_n": <1-20>? }
stores:         { "metric": "sales"|"footfall"|"conversion_rate"|"avg_basket", "order": "desc"|"asc", "top_n": <1-20>? }
reorder:        { "urgency_in": ["CRITICAL"|"HIGH"|"MEDIUM"|"LOW"]? }
page:           { "page": "overview"|"locations"|"footfall"|"customers"|"products"|"inventory"|"re-order"|"ibt"|"pricing"|"ceo-report"|"data-quality"|"exports" }
unknown:        {}

Rules:
- Use "stuck" when the user says "dead stock", "not moving", "0 sales", "locked up".
- Use "phantom" when the user says "zombie", "dead money", "locked up stock", "no sales at all".
- "over X%" -> min_pct (or min_change_pct); "below X%" -> max_pct.
- "haven't bought in N days" -> customers.absent, days_absent_min=N.
- If the user asks to navigate to a page ("go to inventory"), use intent="page".
- Never invent filters you're not sure about. Leave them out.
- If the question is not about the dashboard, use intent="unknown" and put a short helpful message in answer."""


# ─── LLM call ───────────────────────────────────────────────────────

_INTENT_CACHE: Dict[str, Dict[str, Any]] = {}
_INTENT_CACHE_MAX = 200


async def _classify_intent(question: str) -> Dict[str, Any]:
    """Single-shot LLM call → intent JSON. Cached in memory per-question
    for the process lifetime (questions are short + users often re-type
    similar ones)."""
    key = question.strip().lower()
    if key in _INTENT_CACHE:
        return _INTENT_CACHE[key]

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Ask unavailable: LLM key not configured")

    # Lazy import — keeps server startup light if this route is never hit.
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=api_key,
        session_id=f"ask::{abs(hash(question)) & 0xFFFFFFFF}",
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        raw = await chat.send_message(UserMessage(text=question))
    except Exception as e:
        logger.warning("Ask LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    parsed = _coerce_json(raw)
    if not isinstance(parsed, dict) or "intent" not in parsed:
        parsed = {"intent": "unknown", "filters": {}, "answer": "Couldn't parse that — try rephrasing."}
    # trim cache
    if len(_INTENT_CACHE) > _INTENT_CACHE_MAX:
        _INTENT_CACHE.pop(next(iter(_INTENT_CACHE)))
    _INTENT_CACHE[key] = parsed
    return parsed


def _coerce_json(raw: str) -> Optional[Dict[str, Any]]:
    """LLMs occasionally wrap JSON in ```json fences or leading text.
    Strip markdown fences and grab the first {...} block."""
    if not raw:
        return None
    cleaned = raw.strip()
    # Strip ``` fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Fallback — first balanced JSON object in the text
    m = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


# ─── data fetchers per intent ───────────────────────────────────────

async def _fetch_sell_through(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=28)
    # Call our own analytics endpoint via the server helper → not
    # possible (server doesn't proxy itself). Re-implement the minimal
    # aggregation using upstream calls.
    ss = await fetch("/sales-summary", {"date_from": df.isoformat(), "date_to": dt.isoformat()}) or []
    inv = await fetch("/inventory", {}) or []
    stock_by_loc: Dict[str, float] = {}
    for r in inv:
        loc = r.get("location_name") or "Unknown"
        if not isinstance(r.get("product_type"), str):
            continue
        stock_by_loc[loc] = stock_by_loc.get(loc, 0) + float(r.get("available") or 0)
    rows: List[Dict[str, Any]] = []
    for r in ss:
        loc = r.get("channel")
        if not loc:
            continue
        units = int(r.get("units_sold") or 0)
        stock = float(stock_by_loc.get(loc, 0))
        if stock <= 0:
            continue
        denom = stock + units
        pct = (units / denom) * 100.0
        health = "strong" if pct >= 25 else "healthy" if pct >= 12 else "slow" if pct >= 5 else "stuck"
        rows.append({
            "location": loc, "units_sold": units,
            "current_stock": stock, "sell_through_pct": round(pct, 2), "health": health,
        })
    health_in = set(filters.get("health_in") or [])
    if health_in:
        rows = [r for r in rows if r["health"] in health_in]
    mn, mx = filters.get("min_pct"), filters.get("max_pct")
    if isinstance(mn, (int, float)):
        rows = [r for r in rows if r["sell_through_pct"] >= mn]
    if isinstance(mx, (int, float)):
        rows = [r for r in rows if r["sell_through_pct"] <= mx]
    rows.sort(key=lambda x: x["sell_through_pct"])  # worst first — that's usually what users want
    n = max(1, min(20, int(filters.get("top_n") or 10)))
    return {
        "rows": rows[:n],
        "link": "/inventory#sell-through-by-location",
        "row_template": lambda r: {
            "title": r["location"],
            "sub": f"{r['sell_through_pct']:.1f}% · {r['health']} · {r['units_sold']} units / {int(r['current_stock'])} stock",
        },
    }


async def _fetch_stock_aging(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch, fetch_all_inventory  # late import
    # Strategy: pull full inventory via the server's chunked helper (the
    # raw upstream /inventory caps at 2000 rows — nowhere near the full
    # catalog). /sor gives us the top-moving ~200 styles with 28d sales.
    # A style in inventory but NOT in /sor with stock ≥ 30 is phantom.
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=28)
    inv = await fetch_all_inventory() or []
    sor = await fetch("/sor", {
        "date_from": df.isoformat(), "date_to": dt.isoformat(),
    }) or []
    stock_by_style: Dict[str, float] = {}
    for r in inv:
        style = r.get("style_name")
        if not style:
            continue
        stock_by_style[style] = stock_by_style.get(style, 0) + float(r.get("available") or 0)
    sor_by_style = {r.get("style_name"): r for r in sor if r.get("style_name")}
    rows: List[Dict[str, Any]] = []
    for style, stock in stock_by_style.items():
        s = sor_by_style.get(style)
        if s is None:
            # Not in /sor → no sales in 28d (or outside top movers).
            if stock >= 30:
                rows.append({
                    "style_name": style,
                    "current_stock": int(stock),
                    "weekly_velocity": 0,
                    "weeks_on_hand": None,
                    "bucket": "phantom",
                })
            continue
        units28 = s.get("units_sold") or 0
        weekly = units28 / 4 if units28 else 0
        woh = stock / weekly if weekly > 0 else None
        if stock >= 30 and units28 == 0:
            bucket = "phantom"
        elif woh is None:
            continue
        elif woh < 4:
            bucket = "fresh"
        elif woh < 8:
            bucket = "healthy"
        elif woh < 16:
            bucket = "aging"
        else:
            bucket = "stale"
        rows.append({
            "style_name": style,
            "current_stock": int(stock),
            "weekly_velocity": round(weekly, 1),
            "weeks_on_hand": round(woh, 1) if woh is not None else None,
            "bucket": bucket,
        })
    buckets = set(filters.get("buckets") or [])
    if buckets:
        rows = [r for r in rows if r["bucket"] in buckets]
    mn, mx = filters.get("min_woh"), filters.get("max_woh")
    if isinstance(mn, (int, float)):
        rows = [r for r in rows if r["weeks_on_hand"] is not None and r["weeks_on_hand"] >= mn]
    if isinstance(mx, (int, float)):
        rows = [r for r in rows if r["weeks_on_hand"] is not None and r["weeks_on_hand"] <= mx]
    order = {"phantom": 0, "stale": 1, "aging": 2, "healthy": 3, "fresh": 4}
    rows.sort(key=lambda r: (order.get(r["bucket"], 9), -(r["current_stock"] or 0)))
    n = max(1, min(20, int(filters.get("top_n") or 10)))
    return {
        "rows": rows[:n],
        "link": "/inventory#stock-aging-summary",
        "row_template": lambda r: {
            "title": r["style_name"] or "—",
            "sub": f"{r['bucket'].title()} · {r['current_stock']} units · {str(r['weeks_on_hand'])+'w cover' if r['weeks_on_hand'] is not None else 'no sales 4w'}",
        },
    }


async def _fetch_pricing(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=30)
    prev_df = df - timedelta(days=30)
    cur = await fetch("/top-skus", {"date_from": df.isoformat(), "date_to": dt.isoformat(), "limit": 1000}) or []
    prev = await fetch("/top-skus", {"date_from": prev_df.isoformat(), "date_to": df.isoformat(), "limit": 1000}) or []
    pm = {r.get("style_name"): r for r in prev if r.get("style_name")}
    min_change = float(filters.get("min_change_pct") or 2.0)
    direction = filters.get("direction")
    rows: List[Dict[str, Any]] = []
    for r in cur:
        style = r.get("style_name")
        if not style:
            continue
        p = pm.get(style)
        if not p:
            continue
        cu, pu = r.get("units_sold") or 0, p.get("units_sold") or 0
        if cu < 10 or pu < 10:
            continue
        casp = (r.get("total_sales") or 0) / cu if cu else 0
        pasp = (p.get("total_sales") or 0) / pu if pu else 0
        if casp <= 0 or pasp <= 0:
            continue
        delta = (casp - pasp) / pasp * 100.0
        if abs(delta) < min_change:
            continue
        d = "increase" if delta > 0 else "decrease"
        if direction and d != direction:
            continue
        rows.append({
            "style_name": style,
            "current_avg_price": round(casp, 2),
            "previous_avg_price": round(pasp, 2),
            "price_change_pct": round(delta, 2),
            "direction": d,
        })
    rows.sort(key=lambda r: abs(r["price_change_pct"]), reverse=True)
    n = max(1, min(20, int(filters.get("top_n") or 10)))
    return {
        "rows": rows[:n],
        "link": "/pricing",
        "row_template": lambda r: {
            "title": r["style_name"],
            "sub": f"{'↑' if r['direction']=='increase' else '↓'} {r['price_change_pct']:+.1f}% · KES {int(r['previous_avg_price']):,} → KES {int(r['current_avg_price']):,}",
        },
    }


async def _fetch_customers(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch  # late import
    mode = filters.get("mode") or "top"
    n = max(1, min(20, int(filters.get("top_n") or 10)))
    # Pull a deeper slice than `n` so we have room to filter.
    top = await fetch("/top-customers", {"limit": max(100, n * 5)}) or []
    if mode == "absent":
        min_days = int(filters.get("days_absent_min") or 30)
        rows: List[Dict[str, Any]] = []
        today = datetime.utcnow().date()
        for c in top:
            last = c.get("last_purchase_date")
            if not last:
                continue
            try:
                last_dt = datetime.fromisoformat(str(last)[:10]).date()
            except Exception:
                continue
            days = (today - last_dt).days
            if days < min_days:
                continue
            rows.append({
                "customer_id": c.get("customer_id") or c.get("partner_id"),
                "customer_name": c.get("customer_name") or c.get("name") or "—",
                "days_absent": days,
                "total_spend": float(c.get("total_sales") or c.get("total_spend") or 0),
                "phone": c.get("phone"),
            })
        rows.sort(key=lambda r: -r["total_spend"])
        return {
            "rows": rows[:n],
            "link": "/customers",
            "row_template": lambda r: {
                "title": r["customer_name"],
                "sub": f"{r['days_absent']}d absent · KES {int(r['total_spend']):,} lifetime · {r.get('phone') or '—'}",
            },
        }
    # default → top customers by spend
    rows = [{
        "customer_id": c.get("customer_id") or c.get("partner_id"),
        "customer_name": c.get("customer_name") or c.get("name") or "—",
        "total_spend": float(c.get("total_sales") or c.get("total_spend") or 0),
        "phone": c.get("phone") or c.get("phone_masked"),
    } for c in top[:n]]
    return {
        "rows": rows,
        "link": "/customers",
        "row_template": lambda r: {
            "title": r["customer_name"],
            "sub": f"KES {int(r['total_spend']):,} lifetime · {r.get('phone') or '—'}",
        },
    }


async def _fetch_stores(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=28)
    metric = filters.get("metric") or "sales"
    order = filters.get("order") or "desc"
    n = max(1, min(20, int(filters.get("top_n") or 10)))

    # Footfall gives total_footfall, conversion_rate, avg_basket per POS;
    # sales-summary gives net_sales per channel. Pull both and merge on
    # location — that way every metric ranks every store we have data
    # for, not just footfall-counter stores.
    ff = await fetch("/footfall", {"date_from": df.isoformat(), "date_to": dt.isoformat()}) or []
    ss = await fetch("/sales-summary", {"date_from": df.isoformat(), "date_to": dt.isoformat()}) or []
    merged: Dict[str, Dict[str, Any]] = {}
    for r in ss:
        loc = r.get("channel")
        if not loc:
            continue
        merged[loc] = {
            "location": loc,
            "country": (r.get("country") or "").title() or None,
            "sales": float(r.get("total_sales") or r.get("net_sales") or 0),
            "orders": int(r.get("orders") or 0),
            "footfall": 0,
            "conversion_rate": 0.0,
            "avg_basket": float(r.get("avg_basket_size") or 0),
        }
    for r in ff:
        loc = r.get("pos_location") or r.get("channel")
        if not loc:
            continue
        row = merged.setdefault(loc, {
            "location": loc, "country": None, "sales": 0, "orders": 0,
            "footfall": 0, "conversion_rate": 0.0, "avg_basket": 0.0,
        })
        row["footfall"] = int(r.get("total_footfall") or 0)
        row["conversion_rate"] = float(r.get("conversion_rate") or 0)
        if not row.get("avg_basket"):
            row["avg_basket"] = float(r.get("avg_basket") or 0)
    field_unit = {"sales": "KES", "footfall": "visits", "conversion_rate": "%", "avg_basket": "KES"}
    unit = field_unit.get(metric, "")
    cleaned = list(merged.values())
    cleaned.sort(key=lambda r: r.get(metric, 0) or 0, reverse=(order == "desc"))
    def fmt(row):
        v = row.get(metric, 0) or 0
        if unit == "KES":
            return f"KES {int(v):,}"
        if unit == "%":
            return f"{float(v):.1f}%"
        return f"{int(v):,} {unit}"
    return {
        "rows": cleaned[:n],
        "link": "/locations",
        "row_template": lambda r: {
            "title": r["location"],
            "sub": f"{fmt(r)} · {r.get('country') or '—'}",
        },
    }


async def _fetch_reorder(filters: Dict[str, Any]) -> Dict[str, Any]:
    from server import fetch  # late import
    dt = datetime.now(timezone.utc).date()
    df = dt - timedelta(days=28)
    rows = await fetch("/sor", {"date_from": df.isoformat(), "date_to": dt.isoformat(), "limit": 500}) or []
    out: List[Dict[str, Any]] = []
    for r in rows:
        stock = r.get("current_stock") or 0
        units = r.get("units_sold") or 0
        if units <= 0 or stock <= 0:
            continue
        woh = stock / (units / 4)
        if woh >= 4:
            continue
        urgency = "CRITICAL" if woh < 1 else "HIGH" if woh < 2 else "MEDIUM"
        out.append({
            "style_name": r.get("style_name"),
            "current_stock": stock,
            "units_sold": units,
            "weeks_on_hand": round(woh, 1),
            "urgency": urgency,
        })
    urgency_in = set(filters.get("urgency_in") or [])
    if urgency_in:
        out = [r for r in out if r["urgency"] in urgency_in]
    out.sort(key=lambda r: r["weeks_on_hand"])
    return {
        "rows": out[:10],
        "link": "/re-order",
        "row_template": lambda r: {
            "title": r["style_name"] or "—",
            "sub": f"{r['urgency']} · {r['weeks_on_hand']}w cover · {r['current_stock']} units",
        },
    }


# ─── route ──────────────────────────────────────────────────────────

@router.post("/ask")
async def ask(
    body: Dict[str, Any] = Body(...),
    _: User = Depends(get_current_user),
):
    q = (body.get("q") or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="q is required")
    if len(q) > 200:
        raise HTTPException(status_code=400, detail="Question is too long (max 200 chars)")

    intent_doc = await _classify_intent(q)
    intent = (intent_doc.get("intent") or "unknown").lower()
    filters = intent_doc.get("filters") or {}
    answer = (intent_doc.get("answer") or "").strip()

    dispatcher = {
        "sell_through": _fetch_sell_through,
        "stock_aging":  _fetch_stock_aging,
        "pricing":      _fetch_pricing,
        "customers":    _fetch_customers,
        "stores":       _fetch_stores,
        "reorder":      _fetch_reorder,
    }

    if intent == "page":
        page = (filters.get("page") or "").lower()
        link_map = {
            "overview": "/", "locations": "/locations", "footfall": "/footfall",
            "customers": "/customers", "products": "/products", "inventory": "/inventory",
            "re-order": "/re-order", "reorder": "/re-order", "ibt": "/ibt", "pricing": "/pricing",
            "ceo-report": "/ceo-report", "ceo": "/ceo-report",
            "data-quality": "/data-quality", "exports": "/exports",
        }
        link = link_map.get(page)
        return {
            "q": q, "intent": "page", "filters": filters,
            "answer": answer or (f"Opening {page}" if link else "I couldn't match that page."),
            "link": link, "rows": [], "count": 0,
        }

    if intent == "unknown" or intent not in dispatcher:
        return {
            "q": q, "intent": "unknown", "filters": {},
            "answer": answer or "I couldn't match that to a dashboard view. Try: 'stores with stuck stock', 'customers absent 60 days', 'styles whose price went up 10%'.",
            "link": None, "rows": [], "count": 0,
        }

    try:
        result = await dispatcher[intent](filters)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ask fetch failed for intent=%s: %s", intent, e)
        raise HTTPException(status_code=502, detail=f"Couldn't fetch data: {e}")

    rows = result.get("rows") or []
    tmpl = result.get("row_template", lambda r: {"title": str(r), "sub": ""})
    display_rows = [tmpl(r) for r in rows]
    link = result.get("link")

    # Suggested follow-ups — tiny quality-of-life; static per intent.
    followups_map = {
        "sell_through": ["Stores with stuck stock", "Best performing stores this month"],
        "stock_aging":  ["Phantom stock styles", "Styles with cover over 16 weeks"],
        "pricing":      ["Styles whose price went up 10%", "Price decreases with units dropping"],
        "customers":    ["Top customers by spend", "Customers absent for 60 days"],
        "stores":       ["Top stores by conversion rate", "Stores with lowest footfall"],
        "reorder":      ["Critical reorders right now", "All high-urgency reorders"],
    }
    followups = followups_map.get(intent, [])

    return {
        "q": q,
        "intent": intent,
        "filters": filters,
        "answer": answer or f"Found {len(rows)} result(s).",
        "link": link,
        "rows": display_rows,
        "count": len(rows),
        "followups": followups,
    }
