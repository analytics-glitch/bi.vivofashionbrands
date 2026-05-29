"""
2026 Revenue Budget — per-store monthly targets.

Source: 'Revenues Budget 2026 - Team (2).xlsx' supplied by the finance
team on Feb 6, 2026.  Each store's annual target is split into 12
monthly numbers; the YTD-target helper at the bottom prorates the
current month by day-of-month so progress bars don't jump at month
boundaries.

Country roll-ups match the four buckets used by /api/exec-summary
(Kenya, Uganda, Rwanda, Online) — the Online bucket here uses the
"Gross SZ" monthly figures from the budget sheet because that's what
the quarterly-summary country total (99.5M) is built from.
"""

from __future__ import annotations
from datetime import date
from typing import Dict, List, Optional, Tuple


# Per-store monthly targets — index 0 = January, index 11 = December.
# Channel names match the upstream `channel` field used elsewhere in
# the dashboard so the join is direct (no fuzzy-matching).
STORE_TARGETS_2026: Dict[str, Dict[str, object]] = {
    # ── Kenya — Retail ─────────────────────────────────────────────
    "Sarit Centre":    {"country": "Kenya", "monthly": [7181408.78, 7839001.12, 7703064.57, 9794786.88, 8267995.86, 8386974.71, 9716941.03, 10465003.36, 8286316.45, 9175023.95, 11214094.56, 14004384.45]},
    "Junction":        {"country": "Kenya", "monthly": [6877415.12, 6779022.99, 7784347.69, 8348270.68, 8009777.13, 8114961.83, 8358209.43, 9848569.46, 7582229.63, 8546240.80, 9774392.46, 12314112.21]},
    "MAMA NGINA":      {"country": "Kenya", "monthly": [4830227.29, 5367476.69, 6406790.75, 6613876.44, 6525947.48, 5905965.41, 7958100.11, 8218830.96, 6368034.71, 6747029.11, 7522810.50, 8216356.86]},
    "Moi Avenue":      {"country": "Kenya", "monthly": [3960612.78, 4547223.41, 4972229.93, 5864015.81, 6141860.30, 4649926.02, 6893790.72, 7272262.28, 5954602.46, 5801443.45, 6961732.14, 6961732.14]},
    "Garden City":     {"country": "Kenya", "monthly": [3713887.44, 3565875.36, 3618981.10, 3862768.11, 4683216.56, 3722047.51, 5327668.46, 4940974.46, 4182774.72, 6037795.81, 7245354.98, 7245354.98]},
    "Yaya":            {"country": "Kenya", "monthly": [4280441.50, 4318510.31, 4206665.90, 4574677.77, 4826802.62, 4528654.46, 5235186.42, 5253517.45, 5191413.11, 4432854.79, 5319425.75, 5319425.75]},
    "Village Market":  {"country": "Kenya", "monthly": [3191195.65, 3577321.43, 4196807.97, 4258253.96, 4469994.34, 2881782.72, 4523153.22, 6432278.10, 5342862.48, 4112550.99, 4935061.20, 4935061.20]},
    "TRM":             {"country": "Kenya", "monthly": [2952759.78, 3631590.24, 3867079.72, 4126283.64, 3940516.92, 3776288.64, 5115940.79, 4772956.60, 4040548.03, 4392593.69, 5639615.50, 5797731.38]},
    "Capital Centre":  {"country": "Kenya", "monthly": [3301394.23, 3285168.79, 3334690.56, 3472334.23, 3407348.14, 4015646.22, 4393838.25, 4331252.29, 3824149.51, 4177636.00, 5013163.20, 5013163.20]},
    "Galleria":        {"country": "Kenya", "monthly": [2986404.93, 3268845.33, 3423142.75, 3537326.07, 3566363.90, 3692419.45, 3639393.41, 4744742.28, 3454549.51, 3955817.33, 4963411.33, 5185812.05]},
    "Imaara":          {"country": "Kenya", "monthly": [2607844.45, 2879553.56, 3187951.27, 2775798.77, 3713579.09, 3797642.28, 4009490.09, 3779870.29, 3697223.12, 3338375.90, 4006051.08, 4006051.08]},
    "The Hub":         {"country": "Kenya", "monthly": [2449004.21, 2670752.66, 2982521.83, 2947352.04, 3508173.85, 3033145.46, 4016454.72, 3960298.61, 3531008.21, 3439685.51, 4127622.61, 4127622.61]},
    "TWO RIVERS":      {"country": "Kenya", "monthly": [2563060.48, 2169415.67, 2746058.68, 3005102.04, 2795169.26, 3191531.77, 3626287.62, 3671848.91, 3106893.37, 3181175.79, 4578066.57, 5461309.66]},
    "City Mall":       {"country": "Kenya", "monthly": [2112864.56, 2490682.39, 2572093.72, 3014700.12, 3168257.38, 3378773.46, 3831076.06, 4066840.44, 3015306.48, 2601254.26, 4588066.64, 4606685.81]},
    "Westside":        {"country": "Kenya", "monthly": [2293656.73, 2520302.38, 2696035.62, 2787476.96, 3204166.32, 2847998.95, 4003217.25, 3649304.45, 3147016.91, 3429582.57, 4115499.09, 4115499.09]},
    "Rupa Mall":       {"country": "Kenya", "monthly": [2240780.83, 2481332.67, 2341854.87, 3331679.47, 2627255.38, 2563278.75, 3214128.20, 3349866.10, 2697624.88, 2993480.80, 3592176.96, 3592176.96]},
    "Runda":           {"country": "Kenya", "monthly": [2900170.32, 2355632.88, 2717056.61, 2630512.45, 2507383.68, 2409791.97, 3296341.10, 3308843.96, 2980592.97, 3159428.55, 3348994.26, 3348994.26]},
    "Kisumu":          {"country": "Kenya", "monthly": [2326100.68, 2489536.64, 2130002.46, 2370354.49, 2475139.57, 2317021.22, 3138022.95, 3188227.34, 2782511.65, 2984100.22, 3352708.76, 4125259.21]},
    "Signature":       {"country": "Kenya", "monthly": [1655334.42, 2018995.43, 2258212.09, 2319436.32, 2182630.02, 2117165.77, 2910863.31, 3231171.40, 2350020.71, 2631675.67, 3158010.80, 3158010.80]},
    "Mombasa CBD":     {"country": "Kenya", "monthly": [1949381.21, 2553624.13, 2054560.15, 2403497.22, 1977290.67, 2406852.49, 2897602.74, 2614632.37, 2520302.36, 2390188.62, 2868226.34, 2868226.34]},
    "T-Mall":          {"country": "Kenya", "monthly": [1795666.92, 1892640.72, 1650634.74, 2048578.42, 2206366.44, 2244085.27, 2278410.72, 2468754.67, 2347421.97, 2808126.67, 3369752.00, 3369752.00]},
    "Greenspan":       {"country": "Kenya", "monthly": [1727367.15, 1678790.15, 1914837.52, 2061132.12, 1955138.91, 1625373.72, 2577790.19, 2256547.73, 1639671.45, 2734788.66, 3281746.39, 3281746.39]},
    "Kileleshwa":      {"country": "Kenya", "monthly": [1355981.51, 1590672.91, 1717173.12, 1762988.50, 1486180.05, 1480250.28, 1763500.17, 2078863.68, 2358915.37, 1985475.43, 2382570.51, 2382570.51]},
    "Safari Sarit":    {"country": "Kenya", "monthly": [859507.08, 1064056.42, 1696916.71, 1377800.63, 1415781.64, 2025548.88, 1541063.32, 1889991.13, 949698.73, 1519351.38, 1823221.65, 1823221.65]},
    "Meru-Greenwood":  {"country": "Kenya", "monthly": [939292.17, 1025674.62, 890100.71, 1070765.80, 1322082.26, 1202920.93, 1487062.44, 1714655.22, 1292618.22, 1196264.73, 1435517.67, 1435517.67]},
    "Zoya Sarit":      {"country": "Kenya", "monthly": [500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000]},

    # ── Uganda ─────────────────────────────────────────────────────
    "Oasis Mall":      {"country": "Uganda", "monthly": [2269808.55, 2975956.74, 3073631.09, 2980790.94, 3378756.64, 3308714.98, 3413764.96, 3910378.31, 3066594.49, 3924237.90, 4709085.47, 4709085.47]},
    "Acacia Mall":     {"country": "Uganda", "monthly": [6195000, 6195000, 6195000, 6195000, 6195000, 6195000, 6195000, 6195000, 6195000, 8496000, 8496000, 8496000]},

    # ── Rwanda ─────────────────────────────────────────────────────
    "Kigali Heights":  {"country": "Rwanda", "monthly": [3557665.49, 2630475.41, 3592740.88, 2489630.53, 5063588.47, 4221745.60, 3871062.21, 3839508.99, 2832688.07, 5690752.87, 7614199.14, 6394225.33]},
}


# Upstream sales-data channel names use a `Vivo …` prefix and a few
# variants (e.g. "Vivo MSA Digo Road" = budget-sheet "Mombasa CBD",
# "Vivo Eldoret" = "Rupa Mall"). Map upstream channel → budget-sheet
# key so the join in `store_target_block` lands on the right row.
# Updates here when finance / merch changes naming convention.
CHANNEL_ALIAS_TO_TARGET_KEY: Dict[str, str] = {
    # Direct "Vivo X" → budget-sheet "X"
    "Vivo Sarit":            "Sarit Centre",
    "Vivo Junction":         "Junction",
    "Vivo Mama Ngina St":    "MAMA NGINA",
    "Vivo Moi Avenue":       "Moi Avenue",
    "Vivo Garden City":      "Garden City",
    "Vivo Yaya":             "Yaya",
    "Vivo Village Market":   "Village Market",
    "Vivo TRM":              "TRM",
    "Vivo Capital Centre":   "Capital Centre",
    "Vivo Galleria":         "Galleria",
    "Vivo Imaara":           "Imaara",
    "Vivo Hub":              "The Hub",
    "Vivo Two Rivers":       "TWO RIVERS",
    "Vivo City Mall":        "City Mall",
    "Vivo Runda":            "Runda",
    "Vivo Kisumu":           "Kisumu",
    "Vivo Signature Mall":   "Signature",
    "Vivo T- Mall":          "T-Mall",
    "Vivo Greenspan":        "Greenspan",
    "Vivo Kileleshwa":       "Kileleshwa",
    "Vivo Meru":             "Meru-Greenwood",
    "Vivo Kigali Heights":   "Kigali Heights",
    "Vivo Acacia":           "Acacia Mall",
    # Geo-name variants
    "The Oasis Mall":        "Oasis Mall",
    "Vivo MSA Digo Road":    "Mombasa CBD",   # Mombasa CBD store
    "Vivo Eldoret":          "Rupa Mall",     # Rupa Mall is the Eldoret store
    # Stores in budget but not yet visible in upstream sales (closed /
    # not yet open) are intentionally NOT aliased — they'll surface
    # the day they start selling.
    #
    # Stores in upstream but not in the 2026 budget (no target):
    #   "The Oasis Mall Holding Location" — staging/holding, not a real POS
    #   "Vivo Nakuru"      — not in budget sheet
    #   "Vivo M-peace Plaza" (Rwanda) — closed / out of budget
    #   "Vivo Popup"       — pop-up, no annual target
}


def _resolve_target_key(channel: str) -> Optional[str]:
    """Return the budget-sheet key for a given upstream channel name,
    or None if the channel isn't in the budget. Tries direct match
    first, then the alias map."""
    if not channel:
        return None
    if channel in STORE_TARGETS_2026:
        return channel
    return CHANNEL_ALIAS_TO_TARGET_KEY.get(channel)


# Online country bucket — we don't track per-channel online targets
# (the dashboard rolls all online channels into a single "Online"
# country) so we keep it country-level only.  Monthly figures come from
# the "Gross SZ" row of the Online sheet (which matches the 99.5M
# country-total in the Quarterly Summary tab — the other Online rows
# in the sheet are net & gross-Vivo-only sub-views, not country totals).
ONLINE_TARGETS_2026_MONTHLY: List[float] = [
    8489249.84, 6755947.61, 8327701.98, 8005284.57, 7846801.17, 8825976.28,
    7994360.32, 7559754.21, 8165493.58, 7415180.77, 13352515.14, 6784858.86,
]


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _days_in_month(year: int, month: int) -> int:
    """Hand-rolled (no calendar import) — month is 1..12."""
    if month == 2:
        return 29 if _is_leap(year) else 28
    if month in (4, 6, 9, 11):
        return 30
    return 31


def _prorata_to_date(monthly: List[float], as_of: date) -> float:
    """Day-based prorate that respects monthly seasonality:
       sum(full elapsed monthly targets) + current_month_target ×
       (day_in_month ÷ days_in_current_month).
    The current-month slice is computed by *day count*, not fractional
    month progress — so on May 28 the May target is multiplied by
    28/31, on a 30-day month by day/30, etc.  Outside the budget year
    we return 0 to avoid comparing against a phantom target."""
    if as_of.year != 2026:
        return 0.0
    total = 0.0
    for m in range(1, as_of.month):
        total += monthly[m - 1]
    dim = _days_in_month(as_of.year, as_of.month)
    total += monthly[as_of.month - 1] * (as_of.day / dim)
    return total


def _mtd_prorata(monthly: List[float], as_of: date) -> float:
    """MTD = current month's target × day_in_month ÷ days_in_month."""
    if as_of.year != 2026:
        return 0.0
    dim = _days_in_month(as_of.year, as_of.month)
    return monthly[as_of.month - 1] * (as_of.day / dim)


def store_target_block(channel: str, as_of: date) -> Tuple[float, float, float]:
    """Return (annual_target, ytd_target_prorata, mtd_target_prorata)
    for a given channel.  Returns (0,0,0) for unknown stores so they
    won't break the join — the frontend will show a "no target" pill.
    """
    key = _resolve_target_key(channel)
    rec = STORE_TARGETS_2026.get(key) if key else None
    if not rec:
        return 0.0, 0.0, 0.0
    monthly = rec["monthly"]
    annual = sum(monthly)
    return annual, _prorata_to_date(monthly, as_of), _mtd_prorata(monthly, as_of)


def country_target_block(country: str, as_of: date) -> Tuple[float, float, float]:
    """Roll up store targets to a country, plus the Online special-case.
    Returns (annual, ytd_prorata, mtd_prorata)."""
    if country == "Online":
        annual = sum(ONLINE_TARGETS_2026_MONTHLY)
        return annual, _prorata_to_date(ONLINE_TARGETS_2026_MONTHLY, as_of), _mtd_prorata(ONLINE_TARGETS_2026_MONTHLY, as_of)
    annual = 0.0
    ytd = 0.0
    mtd = 0.0
    for _, rec in STORE_TARGETS_2026.items():
        if rec["country"] == country:
            monthly = rec["monthly"]
            annual += sum(monthly)
            ytd += _prorata_to_date(monthly, as_of)
            mtd += _mtd_prorata(monthly, as_of)
    return annual, ytd, mtd
