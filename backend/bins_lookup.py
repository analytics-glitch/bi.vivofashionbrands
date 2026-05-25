"""Bin lookup loaded from the upstream Google Sheet stock take.

The sheet at
  https://docs.google.com/spreadsheets/d/1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs
on tab gid=1405111046 has a 2-column shape (BARCODE,LOCATION). One physical
unit per row, so a single barcode can appear in multiple bins. We collect
every distinct bin per barcode and return them joined with ", " on
lookup. **No bin is excluded** — every label (including H-prefixed)
ships through to the daily replenishment pick list and the warehouse-
to-store IBT report.

This is a snapshot-style dataset (a stock take), so an in-process cache
with a 24 h refresh is fine. Operators can force a refresh via
/api/admin/refresh-bins.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from typing import Dict, List, Optional, Set

import httpx

logger = logging.getLogger(__name__)

SHEET_ID = "1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs"
# Updated 2026-05-05 — operations switched to a cleaner 2-column
# (barcode, location) stock-take tab. GID changed from 563816019
# (old 6-col "Copy of Stock take" layout).
SHEET_GID = "1405111046"
SHEET_CSV_URL = (
    f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export"
    f"?format=csv&gid={SHEET_GID}"
)
TTL_SECONDS = 60 * 60 * 24  # 24 hours — stock take is a daily snapshot

# Iter 87 Phase H — value is now a "bin string" already joined with
# ", " so all callers can render it as-is (no extra logic at the
# consumer site). The internal builder uses an ordered set of bins
# per barcode (insertion-order preserved, deduplicated) before joining.
_cache: Dict[str, str] = {}
_cache_ts: float = 0.0
_lock = asyncio.Lock()


def _row_pairs(row: list[str]):
    """Yield (barcode, bin) pairs from one CSV row.

    The current (2026-05-05) tab has a simple 2-column shape:
    `BARCODE,LOCATION` — one pair per row. The older sheet packed
    3 pairs per row at columns (0,1), (4,5), (8,9); we still tolerate
    that layout by walking in steps of 4, which collapses to a single
    step on a 2-col row.
    """
    cols = len(row)
    if cols == 0:
        return
    # Fast path — 2-col "barcode,location".
    if cols <= 3:
        bc = (row[0] or "").strip()
        bn = (row[1] or "").strip() if cols > 1 else ""
        if bc and bn and bc.lower() not in ("barcode", "location"):
            yield bc, bn
        return
    # Legacy wide layout — step-of-4 walk.
    for start in range(0, cols, 4):
        if start + 1 >= cols:
            break
        bc = (row[start] or "").strip()
        bn = (row[start + 1] or "").strip()
        if not bc or not bn:
            continue
        if bc.lower() in ("barcode", "location"):
            continue
        yield bc, bn


async def _fetch() -> Dict[str, str]:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(SHEET_CSV_URL)
        resp.raise_for_status()
        text = resp.text
    # Build ordered-unique bin sets per barcode. dict.fromkeys preserves
    # insertion order while deduplicating — first-seen-first display, no
    # repeats like "G65,G65,G65" for a barcode with 3 units in G65.
    bins_per_bc: Dict[str, List[str]] = {}
    reader = csv.reader(io.StringIO(text))
    multi_bin_count = 0
    for row in reader:
        for bc, bn in _row_pairs(row):
            # Iter 87 Phase H — H-prefix exclusion REMOVED per ops
            # request 2026-05-25. Every bin (including end-of-life
            # "H*" zones) now ships through to the pick list so floor
            # teams see the complete physical inventory location.
            cur = bins_per_bc.get(bc)
            if cur is None:
                bins_per_bc[bc] = [bn]
            elif bn not in cur:
                cur.append(bn)
                if len(cur) == 2:
                    multi_bin_count += 1
    # Materialise to a flat barcode → "BIN_A, BIN_B" string so consumers
    # don't need any join logic.
    out: Dict[str, str] = {bc: ", ".join(bins) for bc, bins in bins_per_bc.items()}
    logger.info(
        "[bins] loaded %d barcode entries (%d have multiple bins)",
        len(out), multi_bin_count,
    )
    return out


async def get_bins(refresh: bool = False) -> Dict[str, str]:
    """Returns the current barcode → joined-bin-string map. Each value
    is already comma-separated (", "), deduplicated, insertion-order
    preserved. Refreshes lazily after `TTL_SECONDS` or if `refresh=True`."""
    global _cache, _cache_ts
    now = time.time()
    if not refresh and _cache and (now - _cache_ts) < TTL_SECONDS:
        return _cache
    async with _lock:
        if not refresh and _cache and (time.time() - _cache_ts) < TTL_SECONDS:
            return _cache
        try:
            _cache = await _fetch()
            _cache_ts = time.time()
        except Exception as e:
            logger.error("[bins] fetch failed: %s — keeping previous cache", e)
            if not _cache:
                _cache = {}
        return _cache


def lookup(bins: Dict[str, str], barcode: Optional[str]) -> str:
    """Convenience helper used by replenishment + IBT endpoints. Returns
    a pre-joined "BIN_A, BIN_B" string (or "" if barcode unknown)."""
    if not barcode:
        return ""
    return bins.get(str(barcode).strip(), "")
