"""
Product Range Management — 4-Tier classification helpers.

Pure functions (no I/O) implementing the Vivo Product SOP 2026
framework.  Routes layer (`/app/backend/routes/range_mgmt.py`) feeds
`/api/analytics/sor-all-styles` data through these helpers.

Tier definitions (see the user-supplied SOP):
  • Tier 1 — Core Basics    : 24+ months, full price > 90%, 5+ reorders, WOC ≤ 8w
  • Tier 2 — Core Performers: 9-24 months, 3+ reorders, lifetime SOR > 60%, FP > 90%
  • Tier 3 — Recent Performers: passed Week 8/12 gate, < 9 months
  • Tier 4 — New / Test     : < 8 weeks OR pending Week-8 read
  • Retire — overdue or aged out underperformer

Approximations (user-acknowledged):
  • reorder_count ≈ max(1, floor(style_age_weeks / 12))
        Treats each ~12-week run as one open-buy cycle.  User signed
        off on this approximation in the planning Q&A.
  • full_price_pct ≈ (asp_6m / original_price) * 100  (capped 100)
        Treats consistent discounting as a drop in realised price.

Targets (used by RAG banner):
  TIER_TARGETS["Tier 1"] = (30, 50)     # min, max
  TIER_TARGETS["Tier 2"] = (200, 300)
  TIER_TARGETS["Tier 3"] = (150, 200)
  TIER_TARGETS["Tier 4"] = (60, 100)
  TOTAL_TARGET             = (500, 700)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple


TIER_TARGETS: Dict[str, Tuple[int, int]] = {
    "Tier 1": (30, 50),
    "Tier 2": (200, 300),
    "Tier 3": (150, 200),
    "Tier 4": (60, 100),
}
TOTAL_TARGET: Tuple[int, int] = (500, 700)


# Status buckets shown in the classification table.
STATUS_ON_TRACK   = "On Track"
STATUS_AT_RISK    = "At Risk"
STATUS_OVERDUE    = "Overdue"
STATUS_RETIRE     = "Retire"


def approx_reorder_count(age_weeks: Optional[float]) -> int:
    if not age_weeks or age_weeks < 12:
        return 0
    # +1 because age_weeks already includes the original buy.
    return max(0, int(age_weeks // 12))


def approx_full_price_pct(asp: Optional[float], original: Optional[float]) -> Optional[float]:
    """Approximate full-price-realisation %.

    Returns None when we don't have enough info — UI shows '—'.
    """
    if not asp or not original or original <= 0:
        return None
    return max(0.0, min(100.0, (asp / original) * 100.0))


def _passed_week8_gate(
    *,
    lifetime_sor: Optional[float],
    full_price_pct: Optional[float],
    last_sale_days: Optional[float],
    woc: Optional[float],
) -> bool:
    """User SOP Week 8 read: SOR > 60% AND full price > 90% AND last
    sale ≤ 7 days AND WOC ≤ 8 weeks.  Missing values fail closed."""
    if lifetime_sor is None or last_sale_days is None:
        return False
    if lifetime_sor <= 60:
        return False
    if full_price_pct is not None and full_price_pct <= 90:
        return False
    if last_sale_days > 7:
        return False
    if woc is not None and woc > 8:
        return False
    return True


def _passed_week12_backstop(*, lifetime_sor: Optional[float]) -> bool:
    return lifetime_sor is not None and lifetime_sor >= 80


def classify_style(style: dict) -> dict:
    """Returns a dict carrying every metric the tier table & UI need,
    plus the assigned tier and an explanatory `status` + `recommended_action`.

    Expected input keys (from /analytics/sor-all-styles):
        style_name, brand, subcategory, category, soh_total,
        style_age_weeks, sor_since_launch, woc, days_since_last_sale,
        asp_6m, original_price, units_since_launch, weekly_avg,
        style_status, retired_at
    """
    age = style.get("style_age_weeks") or 0.0
    lifetime_sor = style.get("sor_since_launch")
    woc = style.get("woc")
    last_sale_days = style.get("days_since_last_sale")
    full_price_pct = approx_full_price_pct(style.get("asp_6m"), style.get("original_price"))
    reorder_count = approx_reorder_count(age)
    soh = style.get("soh_total") or 0
    weekly_avg = style.get("weekly_avg") or 0

    # ─── Tier assignment ──────────────────────────────────────────
    passed_w8 = _passed_week8_gate(
        lifetime_sor=lifetime_sor, full_price_pct=full_price_pct,
        last_sale_days=last_sale_days, woc=woc,
    )
    passed_w12 = _passed_week12_backstop(lifetime_sor=lifetime_sor)

    tier: str
    status: str
    rec: str

    if age < 8:
        tier = "Tier 4"
        status = STATUS_ON_TRACK if (last_sale_days is not None and last_sale_days <= 14) else STATUS_AT_RISK
        rec = "Monitor weekly until Week 8 read"
    elif 8 <= age <= 12:
        if passed_w8:
            tier = "Tier 3"
            status = STATUS_ON_TRACK
            rec = "Promoted to Tier 3 — monitor weekly"
        else:
            tier = "Tier 4"
            status = STATUS_AT_RISK
            rec = "Missed Week 8 — review again at Week 12"
    elif 12 < age < 36:  # 12 weeks – 9 months
        if passed_w8 or passed_w12:
            tier = "Tier 3"
            status = STATUS_ON_TRACK
            rec = "Graduate to Tier 2 after Month 9 if still performing"
        else:
            tier = "Retire"
            status = STATUS_RETIRE
            rec = "Missed both Week 8 & Week 12 reads — retire to outlet (4-week gap rule)"
    elif 36 <= age < 96:  # 9 – 24 months
        if reorder_count >= 3 and (lifetime_sor or 0) > 60 and (full_price_pct is None or full_price_pct > 90):
            tier = "Tier 2"
            status = STATUS_ON_TRACK
            rec = "Open-buy core performer — monitor monthly"
        else:
            tier = "Retire"
            status = STATUS_AT_RISK
            rec = "Aged Tier 2 candidate failed criteria — flag for retirement review"
    else:  # 24+ months
        if reorder_count >= 5 and (full_price_pct is None or full_price_pct > 90) and (lifetime_sor or 0) > 60:
            tier = "Tier 1"
            status = STATUS_ON_TRACK
            rec = "Permanent core basic — auto-reorder when WOC ≤ 8w"
        else:
            tier = "Retire"
            status = STATUS_RETIRE
            rec = "24+ months without Tier 1 criteria — retire and run-out stock"

    return {
        "style_name": style.get("style_name"),
        "brand": style.get("brand"),
        "subcategory": style.get("subcategory"),
        "category": style.get("category"),
        "style_age_weeks": round(age, 1),
        "lifetime_sor_pct": round(lifetime_sor, 1) if lifetime_sor is not None else None,
        "current_stock": soh,
        "woc": round(woc, 1) if woc is not None else None,
        "last_sale_days": int(last_sale_days) if last_sale_days is not None else None,
        "reorder_count": reorder_count,
        "full_price_pct": round(full_price_pct, 1) if full_price_pct is not None else None,
        "weekly_avg": round(weekly_avg, 2),
        "launch_date": style.get("launch_date"),
        "style_number": style.get("style_number"),
        "tier": tier,
        "status": status,
        "recommended_action": rec,
        # Pre-computed gate flags so the FE can show explanatory pills.
        "passed_week8": passed_w8,
        "passed_week12": passed_w12,
        # Convenience flag for the "approaching gate" tracker.
        "near_week8":  (5.5 <= age < 8) and not passed_w8,
        "near_week12": (8 < age <= 12) and not passed_w8,
    }


def classify_all(rows: List[dict], *, include_retired: bool = False) -> List[dict]:
    """Run `classify_style` on every row, optionally dropping styles
    that the merch team has explicitly retired (Iter 89w list)."""
    out = []
    for r in rows or []:
        if not include_retired and r.get("style_status") == "retired":
            continue
        # Skip Accessories/Sale/non-merch — range mgmt is apparel only.
        cat = r.get("category")
        if cat in ("Accessories", "Sale", "Other", None):
            continue
        out.append(classify_style(r))
    return out


def rag_status(count: int, target: Tuple[int, int]) -> str:
    """RAG label for the summary banner. Green inside the band, amber
    within ±20 % of either edge, red outside that."""
    lo, hi = target
    if lo <= count <= hi:
        return "green"
    edge_lo = max(0, lo - int(round(lo * 0.2)))
    edge_hi = hi + int(round(hi * 0.2))
    if edge_lo <= count <= edge_hi:
        return "amber"
    return "red"


def summarise(classified: List[dict]) -> Dict[str, Any]:
    counts: Dict[str, int] = {"Tier 1": 0, "Tier 2": 0, "Tier 3": 0, "Tier 4": 0, "Retire": 0}
    overdue_w8 = 0
    near_decision_gate = 0
    for r in classified:
        counts[r["tier"]] = counts.get(r["tier"], 0) + 1
        if r["tier"] == "Tier 4" and (r.get("style_age_weeks") or 0) >= 8 and not r.get("passed_week8"):
            overdue_w8 += 1
        if r.get("near_week8") or r.get("near_week12"):
            near_decision_gate += 1

    total = sum(counts[t] for t in ("Tier 1", "Tier 2", "Tier 3", "Tier 4"))
    return {
        "total_active_styles": total,
        "tier_counts": counts,
        "rag": {
            "total": (
                "green" if TOTAL_TARGET[0] <= total <= TOTAL_TARGET[1]
                else "amber" if abs(total - sum(TOTAL_TARGET) / 2) <= sum(TOTAL_TARGET) * 0.1
                else "red"
            ),
            **{t: rag_status(counts[t], TIER_TARGETS[t]) for t in TIER_TARGETS},
        },
        "targets": {**TIER_TARGETS, "total": TOTAL_TARGET},
        "flagged_for_retirement": counts.get("Retire", 0),
        "overdue_for_week8_read": overdue_w8,
        "approaching_decision_gates": near_decision_gate,
    }


def retirement_pipeline(classified: List[dict], *, gap_weeks: int = 4) -> List[dict]:
    """Styles flagged Retire OR Status=AT_RISK at the 9-24mo band.
    Adds a recommended_retirement_date (today) and an outlet_discount_date
    (today + gap_weeks weeks) per the user SOP's 4-week gap rule."""
    today = datetime.now(timezone.utc).date()
    out_date = (today + timedelta(weeks=gap_weeks)).isoformat()
    rows: List[dict] = []
    for r in classified:
        if r["tier"] != "Retire" and r["status"] != STATUS_RETIRE:
            continue
        rows.append({
            "style_name": r["style_name"],
            "brand": r["brand"],
            "subcategory": r["subcategory"],
            "style_age_weeks": r["style_age_weeks"],
            "lifetime_sor_pct": r["lifetime_sor_pct"],
            "current_stock": r["current_stock"],
            "last_sale_days": r["last_sale_days"],
            "recommended_retirement_date": today.isoformat(),
            "outlet_discount_date": out_date,
            "reason": r["recommended_action"],
        })
    # Sort oldest underperformer first.
    rows.sort(key=lambda x: -(x["style_age_weeks"] or 0))
    return rows


def diff_movements(
    classified: List[dict],
    prev_tier_by_style: Dict[str, str],
) -> List[dict]:
    """Compares classified tiers against a previous snapshot and
    returns rows with `direction` = up/down/flat.  Used for the
    "Tier Movement Tracker" panel."""
    out: List[dict] = []
    TIER_ORDER = ["Retire", "Tier 4", "Tier 3", "Tier 2", "Tier 1"]
    rank = {t: i for i, t in enumerate(TIER_ORDER)}
    for r in classified:
        prev = prev_tier_by_style.get(r["style_name"])
        if not prev or prev == r["tier"]:
            continue
        direction = "up" if rank.get(r["tier"], 0) > rank.get(prev, 0) else "down"
        out.append({
            "style_name": r["style_name"],
            "brand": r["brand"],
            "subcategory": r["subcategory"],
            "from_tier": prev,
            "to_tier": r["tier"],
            "direction": direction,
            "style_age_weeks": r["style_age_weeks"],
            "lifetime_sor_pct": r["lifetime_sor_pct"],
        })
    # Newest movements first by impact: graduations to Tier 1/2 first, then demotions.
    out.sort(key=lambda x: (x["direction"] != "up", -rank.get(x["to_tier"], 0)))
    return out
