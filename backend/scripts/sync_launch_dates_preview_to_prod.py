"""One-time migration: sync `style_launch_dates_by_number` from preview → production.

Background — Iter 91q-prod (Jun 2026): the Range Mgmt tier classifier on
the production deployment was over-flagging styles as Tier 4 because the
production Mongo instance is missing roughly 3 years (Nov 2022 → Nov 2025)
of historical launch-date documents that the preview instance already
healed via the BigQuery sweep + 180-day SOR fan-out.

This script:
  1. Connects to BOTH Mongo URIs (preview = source, production = target).
  2. Reads EVERY document from `style_launch_dates_by_number` on preview.
  3. For each preview row, upserts into production keyed on `style_number`:
        $min  first_sale_iso          (never go later than what prod has)
        $max  last_sale_iso, last_observed_at
        $setOnInsert created_at, source_marker = "preview_migration_2026_06"
  4. Skips rows that already exist in prod with an earlier or equal
     `first_sale_iso` (the $min operator makes this a no-op anyway, so
     the script is idempotent — safe to re-run).
  5. Prints a per-1000-doc progress line and a final summary.

USAGE
─────
Both URIs are mandatory; we deliberately do not read them from the
backend `.env` to prevent accidentally pointing source = target. Pass
them on the command line OR via env vars `PREVIEW_MONGO_URL` and
`PROD_MONGO_URL`:

    cd /app/backend
    PREVIEW_MONGO_URL='mongodb://preview-host/dbname' \\
    PROD_MONGO_URL='mongodb://prod-host/dbname' \\
    python scripts/sync_launch_dates_preview_to_prod.py

Or with --uri flags:

    python scripts/sync_launch_dates_preview_to_prod.py \\
        --preview 'mongodb://preview-host/dbname' \\
        --prod    'mongodb://prod-host/dbname'

Add --dry-run to count the gap WITHOUT writing to production.

The script targets the `style_launch_dates_by_number` collection ONLY —
this is the canonical (style_number-keyed) source of truth. The
`style_launch_dates` (style_name-keyed) collection is left alone; it is
the legacy fallback path and will self-heal from production traffic.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne


# Match server.py default — overridable via env if a prod/preview cluster
# uses a different db name (rare; we use a single DB_NAME everywhere).
DB_NAME_DEFAULT = os.environ.get("DB_NAME", "vivo_bi")
SOURCE_MARKER = "preview_migration_2026_06"
COLLECTION = "style_launch_dates_by_number"
BATCH_SIZE = 1000


def _split_uri_and_db(uri: str, fallback_db: str) -> tuple[str, str]:
    """Allow callers to encode db in the URI (`...mongodb.net/mydb`) but
    fall back to the env DB_NAME when the path is missing/empty."""
    # motor accepts the full URI and you call `client[db_name]` — we
    # only need to split the path to pick a default.
    db = fallback_db
    try:
        tail = uri.split("://", 1)[1]
        if "/" in tail:
            candidate = tail.split("/", 1)[1].split("?", 1)[0]
            if candidate:
                db = candidate
    except Exception:
        pass
    return uri, db


async def sync(
    preview_uri: str,
    prod_uri: str,
    db_name: str,
    dry_run: bool,
) -> None:
    if preview_uri == prod_uri:
        raise SystemExit(
            "[abort] preview URI and production URI are identical — refusing to run."
        )

    _, preview_db_name = _split_uri_and_db(preview_uri, db_name)
    _, prod_db_name = _split_uri_and_db(prod_uri, db_name)

    src_client = AsyncIOMotorClient(preview_uri, serverSelectionTimeoutMS=15000)
    dst_client = AsyncIOMotorClient(prod_uri, serverSelectionTimeoutMS=15000)
    src = src_client[preview_db_name][COLLECTION]
    dst = dst_client[prod_db_name][COLLECTION]

    # Confirm both endpoints alive before we start streaming.
    await src_client.admin.command("ping")
    await dst_client.admin.command("ping")
    print(f"[ok] connected — preview db='{preview_db_name}'  prod db='{prod_db_name}'")

    src_count = await src.count_documents({})
    dst_count_before = await dst.count_documents({})
    print(f"[stat] preview docs={src_count:,}  prod docs (before)={dst_count_before:,}")
    print(f"[stat] gap to fill ≈ {max(0, src_count - dst_count_before):,} docs (upper bound)")

    if dry_run:
        # Sample the gap so the user can sanity-check before doing the
        # full write run.
        sample_missing = 0
        sampled = 0
        async for doc in src.find({}, {"style_number": 1, "first_sale_iso": 1}).limit(500):
            sampled += 1
            sn = doc.get("style_number")
            if not sn:
                continue
            existing = await dst.find_one({"style_number": sn}, {"first_sale_iso": 1})
            if existing is None:
                sample_missing += 1
            elif doc.get("first_sale_iso") and existing.get("first_sale_iso") and \
                    doc["first_sale_iso"] < existing["first_sale_iso"]:
                sample_missing += 1
        print(
            f"[dry-run] in a 500-doc sample, {sample_missing} would be inserted-or-min-updated. "
            "Re-run without --dry-run to apply."
        )
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    ops: list[UpdateOne] = []
    total_processed = 0
    total_written = 0

    cursor = src.find(
        {},
        {"style_number": 1, "first_sale_iso": 1, "last_sale_iso": 1, "_id": 0},
        no_cursor_timeout=True,
    )
    try:
        async for doc in cursor:
            sn = doc.get("style_number")
            first_iso = doc.get("first_sale_iso")
            if not sn or not first_iso:
                continue
            last_iso = doc.get("last_sale_iso") or first_iso
            ops.append(
                UpdateOne(
                    {"style_number": sn},
                    {
                        "$min": {"first_sale_iso": first_iso},
                        "$max": {"last_sale_iso": last_iso, "last_observed_at": now_iso},
                        "$setOnInsert": {
                            "created_at": now_iso,
                            "source_marker": SOURCE_MARKER,
                        },
                    },
                    upsert=True,
                )
            )
            total_processed += 1

            if len(ops) >= BATCH_SIZE:
                res = await dst.bulk_write(ops, ordered=False)
                total_written += (res.upserted_count or 0) + (res.modified_count or 0)
                ops.clear()
                print(
                    f"[progress] processed={total_processed:,}  "
                    f"upserted={res.upserted_count or 0}  modified={res.modified_count or 0}"
                )

        if ops:
            res = await dst.bulk_write(ops, ordered=False)
            total_written += (res.upserted_count or 0) + (res.modified_count or 0)
            print(
                f"[progress] processed={total_processed:,}  "
                f"upserted={res.upserted_count or 0}  modified={res.modified_count or 0}"
            )
    finally:
        await cursor.close()

    dst_count_after = await dst.count_documents({})
    print("-" * 60)
    print(f"[done] preview docs read  : {total_processed:,}")
    print(f"[done] prod write effects : {total_written:,} (upserted + modified)")
    print(f"[done] prod docs (before) : {dst_count_before:,}")
    print(f"[done] prod docs (after)  : {dst_count_after:,}")
    print(f"[done] net new docs       : {dst_count_after - dst_count_before:,}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--preview", default=os.environ.get("PREVIEW_MONGO_URL"),
        help="Preview Mongo URI (source). Falls back to env PREVIEW_MONGO_URL.",
    )
    parser.add_argument(
        "--prod", default=os.environ.get("PROD_MONGO_URL"),
        help="Production Mongo URI (target). Falls back to env PROD_MONGO_URL.",
    )
    parser.add_argument(
        "--db", default=DB_NAME_DEFAULT,
        help=f"Database name fallback when URI omits it (default: {DB_NAME_DEFAULT}).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Sample the gap and print stats — do NOT write to production.",
    )
    args = parser.parse_args()

    missing = []
    if not args.preview:
        missing.append("--preview / PREVIEW_MONGO_URL")
    if not args.prod:
        missing.append("--prod / PROD_MONGO_URL")
    if missing:
        parser.error("missing required: " + ", ".join(missing))

    asyncio.run(sync(args.preview, args.prod, args.db, args.dry_run))


if __name__ == "__main__":
    main()
