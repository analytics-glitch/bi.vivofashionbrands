"""Iter 86b/Phase-5 — One-shot backfill for orders_daily_snapshots.

Walks back 90 days from today and populates the Mongo aggregate
collection for every (date × country) that isn't already there. Runs
sequentially day-by-day so we never overwhelm the upstream `/orders`
endpoint — one chunk at a time, with the existing _orders_for_window
split-on-failure recursion handling any flaky days.

Usage:
    cd /app/backend && python -m scripts.backfill_orders_aggregates [--days 90] [--country Kenya]

Prints a progress line per (day × country) and a final summary.

Safety:
    * Idempotent — `replace_one` with upsert. Re-running won't double up.
    * Skips days that already have a doc, unless --force is passed.
    * Catches per-chunk upstream errors so one bad day doesn't abort
      the whole backfill.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Hoist /app/backend onto sys.path so this script runs from anywhere
# (`python scripts/backfill_orders_aggregates.py`).
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


async def _backfill(days: int, only_country: str | None, force: bool) -> int:
    # Lazy-import server.py inside the coroutine — its top-level boot
    # spawns the snapshotter loop which we DON'T want stealing our
    # upstream calls during a backfill run.
    import server  # noqa: E402
    from orders_aggregates import build_daily_doc  # noqa: E402

    db = server.db
    countries = (
        [only_country] if only_country else ["Kenya", "Uganda", "Rwanda", "Online"]
    )
    today = datetime.now(timezone.utc).date()
    day_list = [
        (today - timedelta(days=i)).isoformat()
        for i in range(1, days + 1)  # i=1 → yesterday; today is already handled live
    ]
    logger.info(
        "[backfill] walking %d days × %d countries = %d combos",
        len(day_list), len(countries), len(day_list) * len(countries),
    )
    nm_lookup = server._customer_names_cache[1] or {}
    ct_lookup = server._customer_contacts_cache[1] or {}

    def _walk_in_check(row, loc_name):
        return server._is_walk_in_order(row, nm_lookup, ct_lookup)

    written = skipped = failed = 0
    started = time.time()
    for d in day_list:
        for c in countries:
            existing = await db.orders_daily_snapshots.find_one(
                {"date": d, "country": c}, {"_id": 1},
            )
            if existing and not force:
                skipped += 1
                continue
            try:
                rows = await server._orders_for_window(
                    d, d, country=c, channel=None,
                )
            except Exception as e:
                logger.warning("[backfill] %s c=%s upstream error: %s", d, c, e)
                failed += 1
                continue
            doc = build_daily_doc(d=d, country=c, rows=rows, is_walk_in_fn=_walk_in_check)
            try:
                await db.orders_daily_snapshots.replace_one(
                    {"date": d, "country": c}, doc, upsert=True,
                )
                written += 1
                logger.info(
                    "[backfill] wrote %s/%s — orders=%d walk_ins=%d",
                    d, c, doc["total_orders"], doc["walk_in_orders"],
                )
            except Exception as e:
                logger.warning("[backfill] %s c=%s mongo write failed: %s", d, c, e)
                failed += 1

    elapsed = time.time() - started
    logger.info(
        "[backfill] DONE in %.0fs — wrote %d, skipped %d, failed %d",
        elapsed, written, skipped, failed,
    )
    return 0 if failed == 0 else 2


def main() -> int:
    p = argparse.ArgumentParser(description="Backfill orders_daily_snapshots")
    p.add_argument("--days", type=int, default=90,
                   help="Number of days back from today to backfill (default 90)")
    p.add_argument("--country", type=str, default=None,
                   help="Restrict to one country (Kenya, Uganda, Rwanda, Online)")
    p.add_argument("--force", action="store_true",
                   help="Re-write even if a doc already exists")
    args = p.parse_args()
    return asyncio.run(_backfill(args.days, args.country, args.force))


if __name__ == "__main__":
    sys.exit(main())
