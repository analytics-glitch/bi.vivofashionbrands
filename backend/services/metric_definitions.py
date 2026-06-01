"""Iter 91m — canonical metric definitions (semantic layer).

The data-integrity audit framework (Iter 91l-91m) surfaced that
"Units Sold" had three valid definitions in production (line-item /
catalogued-style / Vivo-merchandise), each with a different number for
the same filter state. Leadership picked **Vivo Merchandise** as
canonical (definition C). This module is the single source of truth
for that definition.

CANONICAL DEFINITION — "Units Sold" (a.k.a. Merch Units Sold)
============================================================
  Units sold of items that are:
    1. Catalogued under a Vivo style_name AND
    2. NOT in an excluded brand (Third Party Brands) AND
    3. NOT in a non-merchandise category (Accessories, Sale, Other)
    4. NOT in unmapped subcategories (e.g. Bags)

Backed by upstream `/subcategory-stock-sales` which already enforces
all four rules.

PUBLIC API
==========
  compute_merch_units_sold(date_from, date_to, country=None,
                           channel=None, locations=None) -> int
    Returns canonical merch-units for the supplied filter state.
    Every endpoint that exposes a "Units Sold" total MUST call this
    helper as its sidecar field so the dashboard's shared metric
    cannot drift across pages.

  MERCH_NON_CATEGORIES — frozenset of category labels excluded from
                         merch (Accessories, Sale, Other).
  is_merch_subcategory(subcat) -> bool  — Boolean filter for any row
                         that exposes a subcategory string.
"""
from __future__ import annotations
from typing import Optional


# Subcategory→Category map lives in server.py; we resolve at call time
# to avoid a circular import. The classification rule itself is:
#   - if subcategory falls under one of these categories → NOT merch
#   - otherwise → merch
MERCH_NON_CATEGORIES = frozenset({"Accessories", "Sale", "Other"})


def is_merch_subcategory(subcat: Optional[str]) -> bool:
    """Return True iff `subcat` qualifies as Vivo merchandise.

    Implementation imports `SUBCATEGORY_TO_CATEGORY` lazily from
    `server` to avoid the import-cycle.
    """
    if not subcat:
        return False
    # Lazy import: server.py imports this module via the services pkg.
    from server import SUBCATEGORY_TO_CATEGORY  # type: ignore
    cat = SUBCATEGORY_TO_CATEGORY.get(subcat)
    if not cat:
        return False  # unmapped subcategories (e.g. Bags) are NOT merch
    return cat not in MERCH_NON_CATEGORIES


async def compute_merch_units_sold(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    channel: Optional[str] = None,
    locations: Optional[str] = None,
) -> int:
    """Canonical merch-units-sold for the supplied filter state.

    Calls `/subcategory-stock-sales` upstream (which already applies
    the Third-Party-Brands exclusion and SKU-catalogue rules) and
    rolls up units_sold across all merchandise subcategories.

    Locations are honoured by hitting the per-location upstream when
    provided; otherwise the country/channel filter is sufficient.
    Caveat: locations-scoped requests fall through to `analytics_sts_by_subcat`
    which currently does NOT honour POS scope at the subcategory units
    level (units_sold in those rows is always 0 when a POS is supplied).
    For canonical board-reporting use (sales-summary / country-summary /
    exec-summary) this is fine — those endpoints are country/channel
    scoped only, never POS-scoped.
    """
    # Lazy imports to avoid circular dependency
    from server import get_subcategory_sales, analytics_sts_by_subcat  # type: ignore
    if locations:
        # POS-scoped path — STS-by-subcat is the closest upstream.
        # Limitation noted above; future iteration will add a proper
        # POS-aware subcat sales rollup if board reporting needs it.
        rows = await analytics_sts_by_subcat(
            date_from=date_from, date_to=date_to,
            country=country, channel=channel, locations=locations,
        )
    else:
        rows = await get_subcategory_sales(
            date_from=date_from, date_to=date_to,
            country=country, channel=channel,
        )
    if not rows:
        return 0
    total = 0
    for r in rows:
        sub = r.get("subcategory")
        if not is_merch_subcategory(sub):
            continue
        u = r.get("units_sold") or 0
        try:
            total += int(u)
        except (TypeError, ValueError):
            pass
    return total
