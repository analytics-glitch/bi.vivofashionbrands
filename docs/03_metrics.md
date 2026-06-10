# 03 · Metrics — Every Number on the Dashboard

This is the master reference for how each KPI / metric is calculated, which upstream data feeds it, and what business rules apply.

## 3.1 The Semantic Layer

All "Units Sold" totals on the dashboard share **one canonical definition** (`services/metric_definitions.py`):

> **Merch Units Sold** = units sold of items that are
>   1. Catalogued under a Vivo `style_name`, AND
>   2. NOT in an excluded brand (Third Party Brands), AND
>   3. NOT in a non-merchandise category (Accessories, Sale, Other), AND
>   4. NOT in unmapped subcategories (e.g. Bags)

Source endpoint: `/subcategory-stock-sales` (already enforces all 4 rules upstream). Exposed via `compute_merch_units_sold(date_from, date_to, country?, channel?, locations?)`.

Why this matters: prior to iter 91m, "Units Sold" had three valid definitions (line-item / catalogued-style / Vivo-merchandise) each giving a different number for the same filter. Leadership picked definition C. Every KPI tile that shows "Units Sold" calls the shared helper so the number cannot drift across pages.

---

## 3.2 Sales Metrics

### 3.2.1 Total Sales (Gross)
- **Definition:** Sum of `total_sales_kes` from `/kpis`.
- **Includes:** All channels (Retail + Online + Wholesale).
- **Excludes:** Refunds (which appear separately under "Returns").
- **Currency:** KES (already converted upstream).

### 3.2.2 Net Sales
- **Definition:** Gross Sales − Returns (in KES).
- **Source:** `returns_aggregator.py` applies `_net_returns()` to row-level arrays globally.
- **Where applied:** `/api/top-skus`, `/api/sor`, `/api/subcategory-sales`, executive summary, country summary.
- **Returns lookup:** `returns_daily_by_product` collection. Pre-aggregated by daily sweep `POST /api/admin/heal-returns-history`.
- **Edge case:** When a return spans a different window than the original sale (returns in current period vs sales in last period), the return is still subtracted from the **current period's** net sales — that's the leadership convention.

### 3.2.3 Average Basket Value (ABV)
- **Formula:** `total_sales_kes / total_orders`
- **Source:** Directly from `/kpis.avg_basket_value`
- **Edge case:** Orders with 0 line items are excluded upstream.

### 3.2.4 Average Selling Price (ASP)
- **Formula:** `total_sales_kes / total_units`
- **Source:** Directly from `/kpis.avg_selling_price`
- **Distinction from ABV:** ABV is per-order; ASP is per-unit. A 3-item basket of 1,000 KES each has ABV = 3,000 and ASP = 1,000.

### 3.2.5 Mass Sales Index (MSI)
- **Formula:** `total_units / total_orders`
- **Interpretation:** Average units per transaction. Higher = customers buying more per visit.
- **Source:** `/kpis.units_per_transaction`

### 3.2.6 Conversion Rate
- **Formula:** `total_orders / total_footfall × 100`
- **Source:** Joins `/kpis.total_orders` with `/footfall.walk_ins`.
- **Caveat:** Footfall only exists for stores with door counters; online channels return 0/N-A conversion.

---

## 3.3 Inventory Metrics

### 3.3.1 Sell-Out Rate (SOR)
- **Formula:** `units_sold / (units_sold + current_stock) × 100`
- **Source:** Upstream `/sor` (already computed) — fallback to live join of `/orders` + `/inventory` if `/sor` fails.
- **Interpretation:**
  - **< 30 %** → red pill — slow seller, candidate for markdown / IBT
  - **30 – 60 %** → amber — monitor
  - **> 60 %** → green — fast seller, replenish

### 3.3.2 Stock-on-Hand (SOH)
- **Definition:** Current available units across all locations (or filtered subset).
- **Source:** `/inventory.available_qty` summed.

### 3.3.3 Weeks of Cover (WoC)
- **Formula:** `current_stock / weekly_velocity_4w`
- **Where `weekly_velocity_4w = units_sold_last_28_days / 4`**
- **Source:** `/api/analytics/weeks-of-cover`
- **Banding:**
  - **< 2 weeks** → red — urgent replenishment
  - **2-4 weeks** → amber — watch
  - **> 4 weeks** → green — safe
- **Ideal:** 12 weeks (per merchandise team policy).

### 3.3.4 Stock-to-Sales (STS)
- **Two views:**
  - **By Category / Subcategory** — `% of stock` vs `% of sales` per category; variance = `pct_sold - pct_stocked`.
  - **By Color / Size** — same but split on the SKU's variant attribute.
- **Variance bands:**
  - **|var| > 3 %** → action needed (red)
  - **|var| 1-3 %** → monitor (amber)
  - **|var| ≤ 1 %** → healthy (green)
- **Endpoints:** `/analytics/stock-to-sales-by-{category, subcat, sku, attribute}`

### 3.3.5 Aged Stock
- **Definition:** Per-SKU stock that hasn't sold in **≥ N days** (where N is user-selectable, default 90).
- **Bucket logic:**
  - **Fresh** — 0-30 days since last sale, healthy WoC
  - **Healthy** — 30-90 days, WoC < 26w
  - **Aging** — 90-180 days
  - **Stale** — 180-365 days
  - **Phantom** — > 365 days OR never sold (zero velocity)
- **Source:** Computed in `/api/analytics/weeks-of-cover` via joining `/inventory` with last-sale dates from `style_launch_dates`.

### 3.3.6 Understock %
- **Formula:** `pct_of_sales - pct_of_stock` (per subcategory)
- **Interpretation:** Positive value means demand outpaces stock; subcategory is under-stocked relative to its sales share.

---

## 3.4 Replenishment Metrics

### 3.4.1 Replenishment Trigger
- **Trigger:** `(POS daily_velocity × 3 days) > current_POS_stock` AND `warehouse_stock > REPL_WH_FLOOR (=1)`
- **Suggested quantity:** `min(target_units − pos_stock, wh_remaining)` where `target_units = REPL_TARGET (=2)` per SKU.
- **Two-pass allocation:** Rows sorted by `missed_sales_risk` DESC, then drawn from a running `wh_remaining[sku]` counter that decrements per row. Invariant: `Σ suggested_qty ≤ wh_available` for every SKU (iter 91r).
- **Endpoint:** `/api/analytics/replenishment-report`

### 3.4.2 IBT (Inter-Branch Transfer) — Store-to-Store
For a row to be suggested, all 7 conditions hold (iter 88):
1. TO store has sold ≥ 1 unit of the style in the window
2. TO and FROM are in the same country
3. FROM stock ≥ `min_move` + 2-unit safety floor
4. FROM is low-velocity (`units_sold ≤ low_pct%` of group avg, default 20%)
5. TO is high-velocity (`units_sold ≥ high_pct%` of group avg, default 150%)
6. TO stock < 5 units (real coverage gap)
7. Move ≥ `min_move` units (default 2)

`movable = min(from_avail - 2, gap_at_to)` where `gap = target_2w − to_stock`. Rows sorted by `estimated_uplift`, then dedup so each `(style, to_store)` has exactly one source.

### 3.4.3 IBT — Warehouse-to-Store
Different shape (warehouse is always source):
1. TO is a physical/POS store (online channels excluded except the `ONLINE_LOCATIONS_WITH_STOCK` allowlist)
2. TO daily velocity ≥ `min_daily_velocity` (default 0.2/day)
3. Store-on-hand < 3-day cover
4. Warehouse has > 0 units
5. `suggested_qty = clamp(target_4w − soh, 0, wh_remaining)` — fill to 4 weeks
6. **Conservation:** Σ suggested ≤ wh_available for every style (iter 91r fix)
7. **Dedup vs store-to-store IBT** (iter 87)
8. **Dedup vs last-3-day Replenishment** (iter 87)
9. **Today's Replenishment exclusion by barcode + SKU** (iter 88t)

Sorted by `missed_sales_risk = daily × max(0, 3-day_target − soh)`.

### 3.4.4 Missed Sales Risk
- **Formula:** `daily_velocity × max(0, target_days − current_stock)`
- **Used by:** IBT-warehouse-to-store, Replenishment urgency sort.

---

## 3.5 Range Management Tier Classification

Each style is assigned a Tier (1-4) based on cumulative sell-rate over its lifetime (`range_mgmt.py`):

| Tier | Definition |
|---|---|
| **Tier 1** | Hero style — top 20% of cumulative sales contribution |
| **Tier 2** | Performer — next 40% |
| **Tier 3** | Slow — next 30% |
| **Tier 4** | Tail — bottom 10% (markdown / clearance candidates) |

**Critical dependency:** Tier classification requires accurate `first_sale_iso` for every style. Styles missing a launch date land in Tier 4 by default (defensive). This is why the launch-date heal sweep matters — a partially-populated `style_launch_dates_by_number` collection produces over-flagged Tier 4 rows.

**Marketing Action Tracker** (Marketing page) uses Range Mgmt tiers to find Tier-3/4 candidates that recently re-activated (sold ≥ 1 unit after 30+ days dormant) — flags them as marketing-push candidates.

---

## 3.6 Customer Metrics

### 3.6.1 RFM (Recency / Frequency / Monetary)
- **Recency:** Days since last purchase. Bucketed: ≤30, 31-60, 61-90, > 90.
- **Frequency:** Lifetime # of orders.
- **Monetary:** Lifetime total spend in KES.
- **Source:** `/customers` upstream.

### 3.6.2 Churn / Churned Customers
- **Definition (current iter):** A customer is "churned" if they have not transacted in the last 90 days (window configurable).
- **Source:** `/churned-customers` + locally cached `analytics/churn`.

### 3.6.3 Customer LTV
- **Definition:** Lifetime sum of `total_sales_kes` for the customer.
- **Source:** `/customers.lifetime_value_kes`.

---

## 3.7 Footfall / Conversion Metrics

### 3.7.1 Footfall (Walk-ins)
- **Source:** `/footfall.walk_ins` per location-day. Stores without counters → 0.
- **Aggregation:** Summed across selected POS / country.

### 3.7.2 Avg Conversion Rate per Weekday
- **Formula:** `mean(daily_orders / daily_walk_ins)` per weekday across the date range.
- **Source:** `/api/footfall/weekday-pattern`.

### 3.7.3 Attach Rate (planned)
- **Formula:** `accessory_units / merch_units`
- **Status:** Backlog (Upcoming Task #8 in PRD).

---

## 3.8 Marketing Action Tracker

### 3.8.1 Candidate selection
A style enters the Marketing Tracker if (any of):
- Tier 3 / Tier 4 in current Range Mgmt classification AND units sold in the last 14 days but dormant 30+ days prior, OR
- Manually added by an admin via the UI.

### 3.8.2 Status lifecycle
`new → contacted_marketing → in_campaign → completed | dropped`

Audit log entry written on every transition.

### 3.8.3 Weekly email digest (Resend)
- **Cadence:** Monday 06:00 East Africa Time.
- **Recipients:** Hard-coded list in `marketing_report.py`.
- **Content:** All `new` + `in_campaign` candidates, grouped by tier + sub-category.
- **Status:** ⚠️ MOCKED — gracefully degrades (logs only) when `RESEND_API_KEY` is unset.

---

## 3.9 Data Quality / Reconciliation

### 3.9.1 Recon Pill
The `Recon ✓` / `Recon ✗` header pill compares:
- KPI snapshot's `total_sales` for the canonical window vs live `/kpis` re-fetch
- If `|delta| / live > 1 %` → red

### 3.9.2 Snapshot Freshness
`Updated N min ago` pill — `now() − max(snapshot_at)` for the canonical (Today, All countries) snapshot.

### 3.9.3 Upstream Status
Counts how many circuit breakers are currently open. `Upstream OK` (green) / `Upstream slow` (amber, fail_counts > 0) / `Upstream down · N breakers` (red, ≥ 1 open).

---

## 3.10 Currency & FX

The dashboard handles ONLY Kenyan Shillings (KES). All values from upstream are **pre-converted** in BigQuery:
- UGX → KES at **28.79**
- RWF → KES at **11.27**
- Rates are static — not pulled from a live FX feed.

The dashboard does NO further conversion. If you ever see UGX/RWF symbols anywhere, that's a bug — file it.

---

## 3.11 Date Windows — what each preset means

| Label | `date_from` | `date_to` |
|---|---|---|
| **Today** | `today` | `today` |
| **Yesterday** | `today − 1` | `today − 1` |
| **7d** | `today − 6` | `today` (rolling 7-day; some pages use `today − 1` as `date_to`) |
| **30d** | `today − 29` | `today` |
| **MTD** | First of current month | `today` |
| **Previous Month** | First of last month | Last day of last month |
| **YTD** | Jan 1 of current year | `today` |
| **Custom** | User-picked | User-picked |

Each page's filter bar lets the user pick a primary window AND a compare window (Last Month / Last Year / Yesterday). Compare windows feed the "vs LM"/"vs LY" deltas on KPI tiles.

---

## 3.12 Corrupt-Entry Registry

`server.py` maintains a hand-curated list of bad upstream rows (mistyped prices, dupe lines) that BigQuery can't easily purge. Each entry specifies:
- `date` (YYYY-MM-DD)
- `order_id`
- `product_token` (case-insensitive substring match on title/name/variant)
- `impact` — explicit per-field correction (e.g., subtract 50,000 KES from sales, +1 unit, etc.)

These corrections are applied to KPI snapshots and live `/kpis` reads when the affected date falls in the queried range. See [06 § Corrupt-Entry Registry](./06_business_rules.md#corrupt-entry-registry).
