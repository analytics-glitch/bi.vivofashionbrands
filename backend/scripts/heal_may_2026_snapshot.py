"""One-off heal: rebuild May 2026 snapshot from weekly chunks.

Background — On 2 Jun 2026 the snapshotter was observed to have
overwritten the May 2026 monthly KPI snapshot with a partial 9.66M
total (true value ~102M). Investigation showed the upstream Vivo BI
API returns truncated data when queried for the exact
2026-05-01 → 2026-05-31 window, but returns correct data when the
same range is split into weekly chunks. Workaround: chunk-fetch &
sum, write the corrected snapshot. The Iter 91r regression guard
(in `_refresh_one_snapshot`) prevents future overwrites with
>50 % drops on sealed past windows.

Run:
    cd /app/backend && python scripts/heal_may_2026_snapshot.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient


CHUNKS = [
    ("2026-05-01", "2026-05-07"),
    ("2026-05-08", "2026-05-14"),
    ("2026-05-15", "2026-05-21"),
    ("2026-05-22", "2026-05-28"),
    ("2026-05-29", "2026-05-31"),
]

# Sum-or-max keys for KPI aggregation. Counts/totals sum;
# averages will be re-derived after aggregation.
SUMMABLE_KEYS = {
    "total_sales", "gross_sales", "total_discounts", "total_returns",
    "net_sales", "total_orders", "total_units",
}
COUNTRIES = [None, "Kenya", "Uganda", "Rwanda", "Online"]


def _agg(parts: list) -> dict:
    """Aggregate weekly KPI dicts: sum the totals, re-derive averages."""
    out = {}
    for k in SUMMABLE_KEYS:
        out[k] = round(sum(float((p.get(k) or 0)) for p in parts), 2)
    ts = out["total_sales"]
    n = out["total_orders"]
    u = out["total_units"]
    rt = out["total_returns"]
    nt = out["net_sales"]
    out["avg_basket_size"] = round(ts / n, 2) if n else 0
    out["avg_selling_price"] = round(ts / u, 2) if u else 0
    out["return_rate"] = round(rt / (rt + nt) * 100, 2) if (rt + nt) else 0
    return out


async def main():
    # Import server's _get_kpis_live (so chunks use the same code path)
    import server

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    print("Healing May 2026 snapshots via weekly chunk-fetch …")
    print()

    for c in COUNTRIES:
        c_label = c or "ALL"
        parts = []
        for df, dt in CHUNKS:
            r = await server._get_kpis_live(date_from=df, date_to=dt, country=c)
            if not isinstance(r, dict):
                print(f"  [WARN] chunk fetch failed for {c_label} {df}..{dt}: {type(r)}")
                continue
            parts.append(r)
            print(f"  fetched {c_label} {df}..{dt}: total_sales={float(r.get('total_sales') or 0):>15,.0f}  orders={int(r.get('total_orders') or 0):>6,}")
        if not parts:
            print(f"  [SKIP] {c_label}: no chunks fetched")
            continue

        merged = _agg(parts)
        snap_id = server._snapshot_id("2026-05-01", "2026-05-31", c, None)
        doc = {
            "_id": snap_id,
            "date_from": "2026-05-01",
            "date_to": "2026-05-31",
            "country": c,
            "channel": None,
            "data": merged,
            "snapshot_at": datetime.now(timezone.utc),
        }
        await db[server._SNAPSHOT_COLL].replace_one({"_id": snap_id}, doc, upsert=True)
        print(f"  WROTE {snap_id}: total_sales={merged['total_sales']:,.0f}  orders={int(merged['total_orders']):,}  units={int(merged['total_units']):,}")
        print()

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
