"""Bin lookup loaded from the upstream Google Sheet stock take.

The sheet at
  https://docs.google.com/spreadsheets/d/1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs
on tab "Copy of Stock take - 28/03/2026" has 3 column-pairs side-by-side
(barcode | location), separated by 2 empty columns each. We fetch the public
CSV export, fold the 3 pairs into one (barcode, bin) list, and skip any bins
whose label starts with "H" (per business rule — those are end-of-life bins
and must NOT appear on the daily replenishment report).

This is a snapshot-style dataset (a stock take from 28/03/2026), so an
in-process cache with a lazy first-call refresh is fine. Operators can force a
refresh via /api/admin/refresh-bins.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from typing import Dict, Optional

import httpx

logger = logging.getLogger(__name__)

SHEET_ID = "1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs"
SHEET_GID = "563816019"
SHEET_CSV_URL = (
    f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export"
    f"?format=csv&gid={SHEET_GID}"
)
TTL_SECONDS = 60 * 60 * 24  # 24 hours — stock take is a daily snapshot

_cache: Dict[str, str] = {}
_cache_ts: float = 0.0
_lock = asyncio.Lock()


def _row_pairs(row: list[str]):
    """Yield (barcode, bin) pairs from one CSV row.

    The sheet packs 3 pairs into a single row at columns (0,1), (4,5), (8,9).
    Empty cells are skipped. We keep the parser flexible — if the upstream
    layout shifts to 2 pairs or 4 pairs, the same step-of-4 walk still works
    until the first empty barcode terminates that pair.
    """
    cols = len(row)
    for start in range(0, cols, 4):
        if start + 1 >= cols:
            break
        bc = (row[start] or "").strip()
        bn = (row[start + 1] or "").strip()
        if not bc or not bn:
            continue
        if bc.lower() in ("barcode", "location"):  # header row
            continue
        yield bc, bn


async def _fetch() -> Dict[str, str]:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(SHEET_CSV_URL)
        resp.raise_for_status()
        text = resp.text
    out: Dict[str, str] = {}
    skipped = 0
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        for bc, bn in _row_pairs(row):
            # Business rule: bins prefixed with "H" are excluded — they're
            # end-of-life zones that should never be replenished from.
            if bn.upper().startswith("H"):
                skipped += 1
                continue
            # Last-write-wins is fine; the same barcode can appear many times
            # (one row per physical unit on the floor) but the bin is the
            # location and we want a representative bin per barcode.
            out[bc] = bn
    logger.info(
        "[bins] loaded %d barcode→bin entries (skipped %d H-bins)", len(out), skipped
    )
    return out


async def get_bins(refresh: bool = False) -> Dict[str, str]:
    """Returns the current barcode→bin map, refreshing if stale or asked."""
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
    """Convenience helper used by the replenishment endpoint."""
    if not barcode:
        return ""
    return bins.get(str(barcode).strip(), "")
