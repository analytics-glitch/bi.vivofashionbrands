"""Bin lookup loaded from the canonical VFG warehouse bin-location sheet.

PRIMARY SOURCE (iter 88d, 2026-05-25): the user-supplied Excel snapshot at
  `/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx`
which has a single sheet ("Bin Location") with a 2-column shape
(BARCODE, BIN). One physical unit per row, so a single barcode can
appear in multiple bins — we collect every distinct bin per barcode and
return them joined with ", " on lookup. **No bin is excluded** —
every label (including H-prefixed end-of-life zones) ships through to
the daily replenishment pick list and the warehouse-to-store IBT report.

FALLBACK: the legacy Google Sheet at
  https://docs.google.com/spreadsheets/d/1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs
on tab gid=1405111046. Used only if the Excel file is missing, so the
upgrade is non-breaking on staging environments that don't yet have the
new artifact.

To refresh the bin list, drop a new XLSX at the path above and POST
/api/admin/refresh-bins — or wait for the 24 h TTL.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import time
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Primary source: local Excel snapshot ──────────────────────────────
BIN_XLSX_PATH = os.environ.get(
    "BIN_XLSX_PATH",
    "/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx",
)

# ── Fallback: legacy Google Sheet ─────────────────────────────────────
SHEET_ID = "1QwXsJUZthhDVL-yo1ru0pvizJiXYFQOi-BeMfKlPDxs"
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


def _row_pairs(row: list):
    """Yield (barcode, bin) pairs from one row (CSV or XLSX).

    Tolerates the legacy wide-format Google Sheet (step-of-4 walk) too.
    """
    if not row:
        return
    cols = len(row)
    # Fast path — 2-col "barcode,bin".
    if cols <= 3:
        bc = (str(row[0]) if row[0] is not None else "").strip()
        bn = (str(row[1]) if cols > 1 and row[1] is not None else "").strip()
        if bc and bn and bc.lower() not in ("barcode", "location", "bin"):
            yield bc, bn
        return
    # Legacy wide layout — step-of-4 walk (Google Sheet "Copy of Stock take").
    for start in range(0, cols, 4):
        if start + 1 >= cols:
            break
        bc = (str(row[start]) if row[start] is not None else "").strip()
        bn = (str(row[start + 1]) if row[start + 1] is not None else "").strip()
        if not bc or not bn:
            continue
        if bc.lower() in ("barcode", "location", "bin"):
            continue
        yield bc, bn


def _build_from_pairs(pair_iter) -> Dict[str, str]:
    """Common builder: turn an iterable of (barcode, bin) pairs into the
    barcode → "BIN_A, BIN_B" joined-string map."""
    bins_per_bc: Dict[str, List[str]] = {}
    multi_bin_count = 0
    for bc, bn in pair_iter:
        # Iter 87 Phase H — H-prefix exclusion REMOVED per ops request
        # 2026-05-25. Every bin (including end-of-life "H*" zones) now
        # ships through to the pick list so floor teams see the
        # complete physical inventory location.
        cur = bins_per_bc.get(bc)
        if cur is None:
            bins_per_bc[bc] = [bn]
        elif bn not in cur:
            cur.append(bn)
            if len(cur) == 2:
                multi_bin_count += 1
    out: Dict[str, str] = {bc: ", ".join(bins) for bc, bins in bins_per_bc.items()}
    logger.info(
        "[bins] loaded %d barcode entries (%d have multiple bins)",
        len(out), multi_bin_count,
    )
    return out


def _load_from_xlsx(path: str) -> Dict[str, str]:
    """Load bins from the canonical VFG Warehouse Bin Locations XLSX.

    Sheet="Bin Location"; columns BARCODE, BIN; one bin per row.
    """
    import openpyxl  # local import — keeps the module load light
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = wb["Bin Location"] if "Bin Location" in wb.sheetnames else wb[wb.sheetnames[0]]

    def _pairs():
        for row in sheet.iter_rows(values_only=True):
            yield from _row_pairs(list(row))

    return _build_from_pairs(_pairs())


async def _load_from_google_sheet() -> Dict[str, str]:
    """Legacy fallback — used only when the XLSX file is missing."""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(SHEET_CSV_URL)
        resp.raise_for_status()
        text = resp.text
    reader = csv.reader(io.StringIO(text))

    def _pairs():
        for row in reader:
            yield from _row_pairs(row)

    return _build_from_pairs(_pairs())


async def _fetch() -> Dict[str, str]:
    """Primary loader — try the XLSX file first, fall back to the Google
    Sheet only if it's missing or unreadable."""
    if os.path.exists(BIN_XLSX_PATH):
        try:
            # openpyxl is sync — run it in a thread so we don't block the
            # event loop on the ~30k-row parse.
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(None, _load_from_xlsx, BIN_XLSX_PATH)
            logger.info("[bins] loaded from XLSX snapshot %s", BIN_XLSX_PATH)
            return data
        except Exception as e:
            logger.error(
                "[bins] XLSX load failed (%s) — falling back to Google Sheet", e,
            )
    else:
        logger.warning(
            "[bins] XLSX not found at %s — falling back to Google Sheet", BIN_XLSX_PATH,
        )
    return await _load_from_google_sheet()


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
