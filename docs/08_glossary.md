# 08 · Glossary

| Term | Definition |
|---|---|
| **ABV** | Average Basket Value — `total_sales / total_orders`. Per-order spend. |
| **Active POS** | A physical store that has had ≥1 sale in the last N days (default 30) and is not in the excluded-channel list. |
| **Aged Stock** | Per-SKU inventory that has not sold in N+ days (user-selectable; bucketed Fresh / Healthy / Aging / Stale / Phantom). |
| **Allocation** | A pre-publish merchandise plan that distributes new-arrival inventory across stores before they hit the shop floor. |
| **ASP** | Average Selling Price — `total_sales / total_units`. Per-unit price. |
| **Attach Rate** | (Planned) `accessory_units / merch_units`. How often customers add-on smaller items. |
| **Auto-heal** | Background sweep that re-populates a Mongo collection when it falls below a threshold (e.g. launch-date heal at < 7,000 docs). |
| **Brand** | One of `Vivo`, `Safari`, `Zoya`, `Sowairina`, `Third Party Brands`. `Third Party Brands` is excluded from "merch" totals. |
| **Channel** | Where a sale happened. Top-level groups: Retail / Online. Specific channels: store names like "Junction Mall", "Online - Shop Zetu". |
| **Circuit breaker** | Per-upstream-path protection that opens after 2 consecutive failures and stays open 30 s. |
| **Compare mode** | The "vs last period" toggle — `last_month` / `last_year` / `yesterday` / `none`. Drives the delta pills on KPI cards. |
| **Conservation pass** | Two-pass greedy allocator that ensures `Σ suggested_qty ≤ warehouse_available` for every style (applied in Replenishment + Warehouse-IBT). |
| **Conversion Rate** | `total_orders / total_footfall × 100`. Foot-traffic to transaction. |
| **Corrupt-Entry Registry** | Hand-curated list of bad upstream rows with explicit per-field corrections applied at read time. |
| **Country attribution** | A sale's country is the country of the originating store (where the transaction physically happened). Returns are attributed to the original sale's country. |
| **DateWindowSelector** | The 7/14/30/60/90-day preset component used to re-window individual tables independently of the global filter bar. |
| **Dedup (IBT / Replenishment)** | Layered exclusion rules ensuring a SKU appears in at most one picker workflow per destination per cycle. |
| **Excluded location** | Warehouses, holding, online wholesale, third-party — filtered out of velocity/sales calcs via `is_excluded_location()`. |
| **First-Sale Price** | The first-ever Kenya unit price for a `style_number`. Used as the canonical "Full Price" anchor by Range Mgmt. |
| **Footfall** | Daily walk-ins per store, from door counters. Stores without counters return 0. |
| **Full Price** | = First-Sale Price (above). |
| **Fanout** | When a single endpoint call expands to multiple upstream calls (e.g. per-country fan-out). Capped by per-endpoint semaphores. |
| **Gross Sales** | Total sales before subtracting returns. |
| **Heal sweep** | A background task that re-builds historical Mongo data by replaying upstream `/orders` calls (idempotent — uses `$min` upserts). |
| **IBT** | Inter-Branch Transfer — moving stock between stores or from warehouse to a store. |
| **Inflight dedup** | When multiple concurrent requests for the same endpoint join a single in-flight compute via `asyncio.Future` instead of each running their own. |
| **KPI Snapshot** | Pre-computed canonical KPI numbers stored in Mongo `kpi_snapshots`, served instead of recomputing on every read. |
| **LM / LY** | Last Month / Last Year — common comparison anchors. |
| **L-10** | "Last 10 launches" — the SOR view for the 10 most recently launched styles. |
| **MSI** | Mass Sales Index — `total_units / total_orders`. Average units per transaction. |
| **Merch / Merchandise** | Catalogued Vivo styles excluding Accessories, Sale, Other categories and Third Party Brands. The canonical "Units Sold" filter. |
| **MTD / QTD / YTD** | Month-to-date / Quarter-to-date / Year-to-date — common date-window presets. |
| **Net Sales** | Gross Sales minus returns. |
| **Net returns** | The amount returned (in KES) that's subtracted from gross to compute net. |
| **POS** | Point of Sale — a physical store location. |
| **Range Management** | The merchandise discipline of deciding which styles to push, replenish, mark down, or discontinue based on tier classification. |
| **RFM** | Recency, Frequency, Monetary — customer segmentation framework. |
| **Replenishment** | Daily warehouse → POS shipment to keep store floors stocked. |
| **Returns** | Customer-initiated refunds. Tracked at line-item level in `/orders` with `transaction_type = "return"`. |
| **Semantic layer** | The canonical definitions module (`services/metric_definitions.py`) that ensures cross-page metrics like "Units Sold" share one source of truth. |
| **Snapshot** | A pre-computed analytics result stored in Mongo, refreshed by background sweeps. |
| **SOR** | Sell-Out Rate — `units_sold / (units_sold + current_stock) × 100`. Higher = faster turnover. |
| **SOH** | Stock On Hand — current available units. |
| **Stale fallback** | When upstream fails, return the most recent good cached response instead of a 5xx. |
| **Style** | A distinct merchandise product, identified by `style_name` and `style_number`. SKUs are per-variant (color × size). |
| **STS** | Stock-to-Sales — comparison of stock share vs sales share, used to flag overstock / understock. |
| **Tier 1/2/3/4** | Range Mgmt classification: Hero / Performer / Slow / Tail, based on cumulative-sales share. |
| **Top-skus** | Top-N styles by sales in the current window. The dashboard's most-called heavy endpoint. |
| **Upstream** | The Vivo BI API on Google Cloud Run — the source of all retail data. |
| **Walk-ins** | = Footfall. |
| **Window** | A date range — global (from FilterBar) or per-table (DateWindowSelector). |
| **WoC** | Weeks of Cover — `current_stock / weekly_velocity_4w`. How many weeks of sales current stock supports. |
