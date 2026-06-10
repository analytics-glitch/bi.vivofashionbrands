# 06 · Business Rules

This is the policy layer — the explicit decisions that turn raw upstream numbers into the dashboard's view of reality.

## 6.1 Channel grouping

Upstream channels split many ways. The dashboard collapses them into 3 groups:

| Group | Includes |
|---|---|
| **Retail** | All physical stores (Junction Mall, The Hub Karen, Two Rivers, Garden City, Diamond Plaza, …) |
| **Online** | Online - Shop Zetu, Online - Vivo, Online - Wholesale |
| **Excluded** | Warehouse, Holding, Third-party Wholesale, Damaged stock, Sample sale |

Implemented in `_normalize_channel_group()` and `is_excluded_location()`.

**Side-effect:** when a user picks Country = "Kenya" + Channel = "Retail", upstream `/orders` is called once per active retail POS in Kenya — about 12 calls fanned out concurrently (semaphore=4). This is why "All countries, Retail" without further filter is slow.

## 6.2 Net Sales — Returns netting

**Source data:** `returns_daily_by_product` Mongo collection — populated daily by `POST /api/admin/heal-returns-history` (sweep that scans `/orders` for `transaction_type == "return"`).

**Application rules (`returns_aggregator.py`):**

1. For any sales aggregation that exposes a "Net Sales" total, the matching `(style, date_range, country, channel)` returns are subtracted post-hoc.
2. Returns are matched by **style_name** when possible, falling back to **style_number** prefix match for renamed SKUs.
3. A return is attributed to the period it was **returned in**, not the period the original sale happened. This is leadership's convention — it preserves cash-flow alignment.
4. Net Sales can be negative (returns exceed sales in the window). The dashboard renders this with a red minus pill.

**Endpoints that apply netting:**
- `/api/top-skus` (live + snapshot paths)
- `/api/sor`
- `/api/subcategory-sales` (when called via top-skus aggregator path)
- `/api/exec-summary`
- `/api/country-summary`

**Endpoints that do NOT net** (intentional — these are gross-sales-anchored):
- `/api/kpis` (gross is the official board number — net is a separate sidecar)
- `/api/sales-summary` (per-channel gross)

## 6.3 Corrupt-Entry Registry

`server.py` holds a hand-curated list of bad upstream rows (mistyped prices, dupe lines, refunded-twice transactions) that BigQuery can't easily purge. Each entry specifies:

```python
{
    "date": "2026-05-13",                              # YYYY-MM-DD
    "order_id": "12345 / VivoBI-Order-12345",          # any of the IDs upstream uses
    "product_token": "wrong product title fragment",   # case-insensitive substring
    "impact": {                                         # explicit corrections
        "total_sales_kes": -47500,                     # subtract from gross
        "total_units": -1,                              # subtract from units
        "total_orders": 0,                              # leave orders untouched
    },
    "note": "Op mistyped 47,500 instead of 4,750 — confirmed with cashier",
}
```

When a corrected date falls inside a queried window, the corrections are added to the KPI totals BEFORE the response is cached / returned. Visible diagnostically on `/api/admin/run-audit-now`.

## 6.4 Active POS detection

A location is "Active POS" iff:
1. `is_excluded_location(channel) == False`
2. Channel does not contain `"online"` or `"third-party"` substring
3. At least 1 unit sold in the last N days (default N=30)

Endpoint: `/api/analytics/active-pos`. Used by the FilterBar POS dropdown so users can't pick stores that no longer trade.

## 6.5 Range Management Tier rules

Tier classification ranks every active style by cumulative-sales contribution (`range_mgmt.py`):

1. Compute `lifetime_sales_kes` per style (sum across all sales since `first_sale_iso`).
2. Sort descending.
3. Walk down, accumulating share:
   - Until cumulative ≥ 20 % → Tier 1 (Hero)
   - Until cumulative ≥ 60 % → Tier 2 (Performer)
   - Until cumulative ≥ 90 % → Tier 3 (Slow)
   - The remaining 10 % → Tier 4 (Tail / Clearance)
4. Styles missing `first_sale_iso` → default to **Tier 4** (defensive).

Re-classification is event-driven (re-computed every time `/range-mgmt/classify` is hit). Cached for 10 min.

**Dedup rule (iter 91q):** When a style appears under two `style_number` prefixes (renamed SKU), the row with the **earliest `first_sale_iso`** wins. This prevents the same garment showing twice in the Range Mgmt grid.

## 6.6 IBT Recommendation Logic

### 6.6.1 Store-to-Store IBT (`/api/analytics/ibt-suggestions`)

All 7 MUST conditions must hold for a row to be suggested:

| # | Rule |
|---|---|
| MUST 1 | TO store sold ≥ 1 unit of the style in window |
| MUST 2 | TO and FROM same country |
| MUST 3 | FROM stock ≥ `min_move` + 2-unit safety floor |
| MUST 4 | FROM low-velocity (`units_sold ≤ low_pct%` of group avg; default 20%) |
| MUST 5 | TO high-velocity (`units_sold ≥ high_pct%` of group avg; default 150%) |
| MUST 6 | TO stock < 5 units |
| MUST 7 | Move ≥ `min_move` (default 2) |

**Allocation:**
1. `target_cover_2w` = `to_velocity × 14`
2. `gap = target_cover_2w − to_stock`
3. `movable = min(from_stock − 2, gap)` — bounded by FROM safety floor
4. Sort by `estimated_uplift = movable × from_price` DESC
5. Greedy dedup: each `(style, to_store)` gets exactly one source; source's `remaining` is debited

### 6.6.2 Warehouse-to-Store IBT (`/api/analytics/ibt-warehouse-to-store`)

Different shape — warehouse is always source, no relative-velocity comparison:

| # | Rule |
|---|---|
| 1 | TO is a physical / POS store (online channels excluded except `ONLINE_LOCATIONS_WITH_STOCK` allowlist) |
| 2 | TO daily velocity ≥ `min_daily_velocity` (default 0.2/day) |
| 3 | Store-on-hand < 3-day cover |
| 4 | Warehouse stock > 0 |
| 5 | `suggested_qty = clamp(target_4w − soh, 0, wh_remaining)` — fill to 4 weeks |

**Conservation (iter 91r):** Two-pass greedy
1. Build candidates with `(need, missed_sales_risk)` — no allocation yet.
2. Sort by `(-risk, -need)`.
3. Allocate from `wh_remaining[style]` running counter that decrements per row.
4. **Invariant:** `Σ suggested_qty(style=X) ≤ wh_available(X)` for every style.
5. Each row reports `warehouse_remaining_after`.

**Dedup layers (warehouse-IBT):**
- Layer A — exclude pairs already in store-to-store IBT (`ibt_destinations_for_dedup`)
- Layer B — exclude pairs in last-3-day Replenishment report (`_replenishment_pairs_for_dedup`)
- Layer C — exclude barcode/SKU matches in today's Replenishment (iter 88t)
- Layer D — keep only highest-risk row per `(style, to_store)` (defensive)

A SKU can only appear in **one** picker workflow per destination per cycle. Priority order: **Store-to-store IBT > Replenishment > Warehouse IBT**.

## 6.7 Replenishment Logic

Daily warehouse → POS sheet, run on demand via `/api/analytics/replenishment-report`.

**Per-(POS, SKU) trigger:**
1. POS daily velocity (last 7 days) × 3 days > POS current stock
2. Warehouse has > `REPL_WH_FLOOR (=1)` available
3. SKU is not in any blocklist (excluded categories, etc.)

**Quantity:**
- `target_units = REPL_TARGET (=2)` per SKU on the POS floor
- `deficit = target_units − pos_stock`
- `take = min(deficit, wh_avail − REPL_WH_FLOOR)`
- Allocated from a running `wh_remaining[sku]` counter — same conservation pattern as warehouse-IBT.

**Output columns:**
- POS, Bin (from `bins_lookup.py`), SKU, Barcode, Style, Brand, Subcat, Current Stock, Daily Velocity, Suggested Qty, Reason, Owner, First-Seen-At.

**State machine:**
- Picker marks done via `POST /api/analytics/replenishment-report/mark` → row moves to `replenishment_completed` collection.
- Re-shown next day if conditions still met (idempotent).

## 6.8 Bin lookup rules

Source: `/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx`. Schema is exactly two columns: `Barcode`, `BIN`. Multiple rows per barcode are allowed — each (barcode, bin) pair is a separate row.

Loader (`bins_lookup.py`):
1. Reads the first sheet (fallback if "Bin Location" sheet doesn't exist).
2. Skips header row.
3. For each barcode, **deduplicates bins, preserves insertion order, joins with `", "`**.

Refresh path:
1. Replace the XLSX file at `/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx`.
2. POST `/api/admin/refresh-bins` (admin auth required).
3. Verify by checking the `Bin` column in `/api/analytics/replenishment-report`.

## 6.9 Style status (Active / Retired / All)

A style is **Retired** if:
- Last sale > 180 days ago, AND
- Current stock < 5 units, AND
- Not flagged as `style_status = "incoming"` (pre-launch)

Otherwise **Active**. Computed in `annotate_status()` on every list endpoint that takes `style_status` param.

## 6.10 PII gating

Customer phone numbers, emails, full names are returned only to users with role `admin`. For non-admin callers:
- Phone → masked to `+254 *** *** 678` (last 3 digits visible)
- Email → masked to `j****@vivofashiongroup.com`
- Name → first name only

Applied in `mask_customer_pii()` middleware.

## 6.11 Sales-to-channel attribution

Each order has exactly one `channel` (where the transaction occurred). Returns are attributed to the **original channel** of the order, not the channel where the return was processed. This is so a store doesn't appear to lose sales because Online customers happen to return to a physical store.

## 6.12 Snapshot canonicality

A snapshot's "canonical" window/filter is:
- Window: `Today | Yesterday | 7d | 30d | MTD | QTD | YTD | Previous Month`
- Country: `None (All) | Kenya | Uganda | Rwanda`
- Channel: `None (All) | Retail | Online`

Only canonical combos are pre-warmed. Non-canonical (custom brand filter, custom date range, specific POS) always falls through to live compute.

## 6.13 First-Sale Price = Full Price

Leadership convention: "Full Price" of a style is its **first-ever Kenya unit price** (not the upstream MSRP, which can lag promos). Captured in `first_sale_price_ke` Mongo collection by the launch-date heal sweep. Used by Range Mgmt as the canonical anchor for markdown calculations.

## 6.14 Auto-heal threshold

On startup, if `style_launch_dates_by_number` has **< 7,000 docs** (iter 91s — raised from "fully empty"), the backend auto-fires a 5-year launch-date sweep after a 10-minute delay (so initial login burst clears). The heal is idempotent (`$min` upserts). Cooperative-cancellable via `POST /api/admin/heal-launch-dates/stop`.
