# Vivo Fashion Group — BI Dashboard PRD

## Original Problem Statement
Comprehensive BI dashboard for Vivo Fashion Group (East Africa). Proxies a third-party Vivo BI API and surfaces it through multiple authenticated, filterable tabs.

## Hard Product Rules
- **Theme**: Light orange background, dark/bright green accents.
- **Currency**: ALL currency shown in `KES` with thousands separators. Never use `$`.
- **Single source of truth**: Upstream API. KPIs across pages must agree (shared `/api/kpis` fetch).
- **Auth**: Emergent Google OAuth + JWT. PII masked by role.
- **Dopamine Design**: Streaks, badges, celebration micro-interactions, conversational briefings, actionable subtitles on every KPI (metric-action contract).
- **`total_sales`** is the canonical top-level revenue field (gross minus discounts). Do **not** swap to `net_sales` on global KPIs unless explicitly requested.

## Stack
- Frontend: React + Tailwind + Recharts
- Backend: FastAPI + httpx (single shared `AsyncClient` with `Limits(max_connections=200, max_keepalive_connections=50)` and `Timeout(read=45, connect=10, pool=15)`)
- DB: MongoDB (auth, notifications, recommendations state, leaderboard snapshots, activity logs)
- LLM: `emergentintegrations` + Claude (Emergent LLM Key) for `/api/ask` natural-language search

## Key Backend Modules
- `server.py` — FastAPI proxy + analytics (>2600 lines, refactor candidate)
- `auth.py`, `pii.py`, `chat.py`, `leaderboard.py`, `recommendations.py`, `user_activity.py`
- `thumbnails.py`, `notifications.py`, `search.py`, `ask.py`

## Key API Endpoints
`/api/kpis`, `/api/sales-summary`, `/api/inventory`, `/api/customers`, `/api/customers/walk-ins`, `/api/footfall`, `/api/data-freshness`, `/api/top-skus`, `/api/sor`, `/api/analytics/sor-new-styles-l10`, `/api/analytics/sor-all-styles`, `/api/analytics/style-sku-breakdown`, `/api/analytics/new-styles-curve`, `/api/analytics/sales-projection`, `/api/analytics/ibt-suggestions`, `/api/analytics/ibt-sku-breakdown`, `/api/analytics/sell-through-by-location`, `/api/analytics/weeks-of-cover`, `/api/analytics/inventory-summary`, `/api/analytics/churn`, `/api/analytics/new-styles`, `/api/analytics/category-country-matrix`, `/api/notifications`, `/api/notifications/unread-count`, `/api/search`, `/api/search/customers`, `/api/ask`, `/api/recommendations/*`, `/api/thumbnails/*`

## Implemented (highlights)
- Authenticated dashboard, role-based PII masking, audit logs
- Overview, Locations, Footfall, Customers, Products, Inventory, Re-Order, IBT, Pricing, CEO Report, Data Quality, Exports

### Recent (Feb 2026 — Iter 47/48)
- SOR Report (Exports tab): added `Units Since Launch` + `SOR Since Launch` columns sourced from a 3-year lifetime `/top-skus` window
- SOR Report: 3-level drill — Style row → Color rollups → click a Color to expand its Sizes
- SOR Report: "Where did it sell?" Location pane is now sortable on every column (Location / Units 6M / SOH / SOR)
- Inventory page: products-search filter now correctly cascades to sales-side (Stock-to-Sales by Cat & Subcat) — added `/top-skus` fetch + `salesByVisibleSubcat/Category` override; `/api/top-skus` limit cap raised from 200 → 10000 to support the full catalog rollup
- Removed broken `/products` upstream call from `analytics_sor_all_styles` (upstream returns 404); modal lifetime ASP from `/top-skus` is now the canonical Original Price source

### Recent (Feb 2026 — Iter 49)
- New endpoint `/api/analytics/kpi-trend` — bucketed (day/week/month/quarter) KPI trend; fans out parallel `/kpis` per bucket via asyncio.gather; returns full payload (total_sales, net_sales, units_sold, orders, ABV, discount, returns, return_rate)
- KPI Trend chart on Overview rewritten:
  - Single line (totals) — country comes from global filter bar (no per-country fan-out)
  - Period selector (Daily / Weekly / Monthly / Quarterly) with auto-default heuristic by range length, manual override + reset
  - Returns / Discount / ABV no longer render as flat-zero (root cause: previous chart hit `/daily-trend` which lacked those fields)
- Targets page: removed duplicate "Projection vs Target" header pill from the Detailed breakdown card (`AnnualTargetsCard variant='full'`) — already shown by the Overall donut tile above

### Recent (Feb 2026 — Iter 50)
- Total Sales Summary (Targets page) restyled to match customer's daily PDF format:
  - Row groups: Kenya retail → TOTAL RETAIL KENYA subtotal → Rwanda / Uganda / Online → TOTAL BUSINESS REVENUE grand total
  - Dark-gray header / light-green totals / red-negative-variance / green-positive-YoY
  - Backend rows include `display_name`, `country`, `group`
  - Like-for-like comparison windows for Var vs Mar / Var vs Apr 25
  - Download CSV + PNG buttons via html2canvas
- IBT page filters: added Store FROM, Store TO, Sub-Cats dropdowns + Clear button
- IBT dedupe: each (style, to_store) destination receives stock from at most ONE source store (FROM-capacity tracking prevents two destinations double-claiming the same units)
- Warehouse → Store IBT: rows now expandable showing color × size SKU breakdown via reused `IBTSkuBreakdown`

### Recent (Feb 2026 — Iter 51/52)
- **Total Sales Summary**: added Download PDF button (jsPDF, A4 landscape paginated). PNG / PDF now render at fixed 1400px desktop width with scale=3 → sharp on mobile + zoom-friendly. Table also fits-to-content (`tableLayout:auto` + `whitespace-nowrap`) — no wasted column whitespace.
- **CEO Report Top 10 Best SOR**: filtered out Accessories category + anything containing "Zoya". All 4 column headers now sortable (asc/desc) with ▲/▼ indicator and units_sold tiebreaker.
- **Feedback page** (`/feedback`): standalone form (any logged-in user can submit). Categories: bug · feature · data · general. Backed by `/api/feedback` (POST + GET /mine).
- **Admin Feedback Inbox** (`/admin/feedback`): admin-only inbox; mark-resolved toggle; admin notes; status filters (open/resolved/all). Backed by `/api/feedback` (GET admin + PATCH).
- **IBT Warehouse → Stores**: now excludes `Online`, `Shop Zetu`, `Studio`, `Wholesale` channels as destinations.
- **Page header sizing**: 14 page H1s migrated from fixed `text-[22px] sm:text-[28px]` to `text-[clamp(18px,2.2vw,26px)] line-clamp-2`.
- **Allocations page** (`/allocations`): velocity + low-stock blended scoring with size-pack distribution.
- **Store-Manager role tightened**: now sees ONLY Locations + Exports + IBT + Feedback.

### Recent (Feb 2026 — Iter 60)
- **IBT page rewritten as flat SKU-level tables**:
  - Both **Store → Store** and **Warehouse → Store** lists now show one row per SKU (color × size). Color, Size, SKU, Barcode are visible columns — no expand toggle. Built `IBTFlatTable` component which fans out the SKU breakdown for every visible suggestion (concurrency-bounded, in-memory cached).
  - Each row has an **inline "Actual transferred" number input** so the warehouse picker can record what was actually shipped before tapping the action button.
  - **"Mark As Done"** button (renamed from "Done") replaces the previous "Change" dropdown / RecommendationActionPill. Single action, single workflow.
  - **Tablet-friendly**: sticky Style column, 36px input height, py-2 buttons, horizontal scroll only when needed (`min-w-max`). Clean on iPad portrait + landscape.
  - Mark-as-Done is now SKU-granular: marking one SKU done no longer suppresses sibling SKUs of the same parent suggestion. Backend `/api/ibt/completed/keys` returns both legacy parent keys and new `sku_keys`; frontend filters per-row by `<style>||<to_store>||<sku>`.
  - `/api/ibt/complete` body and `CompletedMove` response now accept/persist optional `sku`, `color`, `size`, `barcode` fields.
  - `/api/analytics/ibt-sku-breakdown` enriched to include `barcode` per SKU; **global SKU→barcode fallback** added so barcodes that are missing on the per-store rows (POS exports sometimes omit barcode for non-carrying stores) get filled from the full inventory snapshot. Verified: Vivo Meru → Vivo Sarit now returns barcodes for all 6 SKUs (was all blank); Vivo Dua Wide Leg Pants WH→Kigali now returns barcodes for all 5 SKUs.

### Recent (Feb 2026 — Iter 59)
- **Performance pass — production resilience under degraded upstream**:
  - **Frontend `_respCache` persists to `sessionStorage`**: cache survives page navigation, BFCache restore, and hard refresh within a tab. Hydrated on app boot. Wiped on logout. Debounced flush (250ms) so a request burst pays one stringify.
  - **Frontend cache TTL bumped 60s → 5min** for the long-tail (KPIs, sales, inventory) — these refresh on the order of minutes upstream. Hot endpoints (notifications, ibt/late-count, data-freshness) keep a tight 30s window via a `FAST_TTL_PATHS` allow-list.
  - **All 19 authed pages now lazy-loaded via `React.lazy`** in `App.js` — initial JS bundle shrinks dramatically; first paint after login is much faster. Each page's chunk loads only when the user navigates to it. Suspense fallback shows the existing `Loading` spinner.
  - **Backend `/locations` stale fallback**: when upstream `/locations` circuit-breaker is OPEN (caused the production "circuit-breaker OPEN — failing fast" banner the user reported), the endpoint now serves the last-known list from `_kpi_stale_cache` (24h disk-persisted). Last-resort: synthesize from `EXTRA_INVENTORY_LOCATIONS` so the filter dropdown is never empty.

### Recent (Feb 2026 — Iter 58)
- **Regression sweep** (test_iteration_58_regression.py, 27/28 PASS): smoke endpoints, Two-Stage Allocations (calculate / save / save-warehouse / runs), IBT mark-as-done + late-count + completed audit, Auth approval flow (/auth/me + /auth/me/status), Feedback CRUD, Monthly Targets, role gating all green. No critical regressions. One UX polish: `MonthlyTargetsTracker` now exposes `data-testid="monthly-targets-tracker"` even during loading/error/empty states for cold-cache resilience and stable automation.

### Recent (Feb 2026 — Iter 56)
- **Allocations · Two-card layout**: split the result section into (a) **Suggested allocation** (read-only — Store/Packs/Units/sizes/Sold/SOH/Score) and (b) **Warehouse Fulfillment Tracker** (editable per-store packs with summary tiles for Suggested total / Allocated by warehouse / Variance, plus Δ packs and Fulfilled % per row). Save lives on the warehouse card and persists both numbers to the audit trail. Optimistic merge fixed so saved runs don't briefly disappear after refresh.

### Recent (Feb 2026 — Iter 55)
- **Monthly Sales Target Tracker** now also embedded on `/locations` page (admin/exec/store-manager friendly view).
- **Suggested Daily Need column** added to the Monthly Tracker daily breakdown — shows what the store needs to do per day on remaining days to still hit target, **re-weighted by the day-of-week pattern** (Saturdays get a bigger ask than Tuesdays). Each store header also shows a "Need / day" stat (gap_to_target / days_remaining). Colour-coded red/amber/green vs. original budget.
- **Allocations · Editable Packs**: each row's pack count is now an inline number input — typing recalculates that row's units and sizes immediately. "Reset to suggested" button reverts all overrides. CSV export shows both suggested and allocated columns side-by-side.
- **Allocations · Style Type filter**: New (free-text style name) vs Replenishment (dropdown of existing styles via `/api/allocations/styles?subcategory=…`). For replenishment, velocity + low-stock score is computed for the specific style only (not subcategory-wide).
- **Allocation persistence + history**: new `allocation_runs` collection. New endpoints `POST /api/allocations/save`, `GET /api/allocations/runs`, `GET /api/allocations/runs/{id}`. New `AllocationRunsHistory` component below the calculator shows every saved run, expandable per-row to see suggested-vs-allocated detail, with per-row CSV download. Optimistic prepend so newly-saved runs appear instantly.

### Recent (Feb 2026 — Iter 54)
- **"Late Transfers" alert badge** on the IBT nav: red animate-pulse pill showing the count of IBT suggestions first surfaced >5 days ago that nobody has marked done yet.
  - New collection `ibt_suggestions_seen` auto-populated by `/ibt-suggestions` and `/ibt-warehouse-to-store` (fire-and-forget tracker so suggestion latency is unaffected).
  - New endpoint `GET /api/ibt/late-count` subtracts completed pairs from old seen pairs.
  - Sidebar polls every 5 min on both desktop + mobile nav variants.

### Recent (Feb 2026 — Iter 53)
- **IBT Last-30-days default**: every visit to `/ibt` forces the global filter bar to "Last 30 days" preset on mount.
- **IBT Mark-as-Done flow**: each suggestion row has a green "Done" pill that opens a modal capturing PO#, transfer date, completed-by name, actual units moved. Submitting POSTs to `/api/ibt/complete` (new module `ibt_completed.py`). Completed (style, to_store) pairs are hidden from the live suggestion table. Available on both store-to-store and warehouse-to-store sections.
- **Completed Moves Report** (admin-only): renders below IBT suggestions with full audit columns (Style / From / To / Units / Day suggested / Day transferred / Days lapsed / PO# / Completed by). Backed by `/api/ibt/completed`.
- **Exports page · store_manager gating**: store-manager users see ONLY the Inventory tab (Sales / Store KPIs / Period / Stock / Replenishment / SOR tabs hidden).
- **Sign-up approval flow**: Google OAuth first sign-in now creates `status="pending"` accounts with default role `store_manager`. Pending users see an "Awaiting admin approval" screen with 30s auto-poll instead of the dashboard. Admin approves/rejects via the new "Pending Approvals" banner on `/admin/users`. Existing accounts back-filled to `status="active"` on backend startup.
  - Row groups: Kenya retail → TOTAL RETAIL KENYA subtotal → Rwanda / Uganda / Online → TOTAL BUSINESS REVENUE grand total
  - Dark-gray header / light-green totals / red-negative-variance / green-positive-YoY
  - Backend rows now include `display_name`, `country`, and `group` (kenya_retail | kenya_online | uganda | rwanda | other)
  - Like-for-like comparison windows for Var vs Mar / Var vs Apr 25 columns
  - **Download PNG** button via html2canvas — perfect for daily WhatsApp/email blasts
  - **CSV** export retained for machine-readable use
- IBT page filters: added Store FROM, Store TO, Sub-Cats dropdowns + Clear button (data-testids `ibt-from-store-filter`, `ibt-to-store-filter`, `ibt-subcat-filter`, `ibt-clear-filters`)
- IBT dedupe — **`/api/analytics/ibt-suggestions` now guarantees each (style, to_store) destination has at most ONE source store**, with FROM-capacity tracking so two destinations can't double-claim the same units (prevents overstock at the destination)
- Warehouse → Store IBT: rows are now expandable, showing color × size SKU breakdown (reuses `IBTSkuBreakdown` with `from_store="Warehouse Finished Goods"`) — `/api/analytics/ibt-sku-breakdown` extended to detect warehouse FROM and aggregate stock across all warehouse locations
- Stock aging (weeks-on-hand) + phantom stock anomaly detection
- Mobile card-views for all wide tables (`SortableTable.jsx`)
- Notifications bell (stockouts, records, anomalies)
- ⌘K global search + "Ask anything" LLM-powered NLP query
- Sell-through rate per location, time-of-day footfall heatmap
- Pricing changes tracking page
- Product thumbnails (Products, Re-Order, IBT)
- SOR New Styles L-10 report (3–4 month-old styles)
- Streaks, leaderboard, daily briefing, dopamine micro-interactions
- Statistical outlier flagging (`useOutliers.js`)

## Recently Shipped (2026-04-26 / 27 / 28 / 29 / 30 / 5-1 / 5-4 / 5-5)
## Recently Shipped
- **Iter_56** (2026-05-05) — **SOR Report drill-down: Color × Size + per-Location panes**:
  - **New**: clicking any row in the SOR Report tab now does TWO things in parallel:
    1. Expands inline showing the **Color × Size SKU breakdown** ([data-testid=sor-sku-breakdown]) with units 6M, % of style, units 3W, SOH, SOH WH, % In WH per variant.
    2. Updates the **per-Location pane** on the right ([data-testid=sor-location-pane]) with location, units 6M, SOH, and SOR per location — exactly matching the screenshot the user shared.
  - Backend: new endpoint `GET /api/analytics/style-location-breakdown` and refactored `_compute_style_breakdowns` helper that does ONE /orders fan-out and populates BOTH the SKU and location caches in a single pass. Frontend fires both endpoints concurrently; the second one hits warm cache (<200ms) once the first finishes.
  - **Performance fix (cold scans + 60s ingress timeout)**: rare styles' /orders fan-out exceeds the 60s gateway timeout. Solved with an `asyncio.shield`'d background task pattern — first call returns either 200 with data (if scan finishes in <50s) OR HTTP 202 with `{computing: true, retry_after: 15}`. Frontend polls every 15s for up to 2 minutes. The shared task means polling either endpoint resolves both. Tested at 60-90s scan completion for non-popular styles.
  - **SortableTable** now supports `rowClassName` (function returning per-row Tailwind classes — used for the amber selected-row highlight) and dual-fires `onRowClick` even when `renderExpanded` is set (so a click both expands the row AND selects it).
  - **Tested via testing_agent (Iter_46)**: Backend 6/6 PASS, Frontend integration confirmed — cold-cache clicks trigger two 202s, polling timer re-issues every 15s, both panes populate at t≈110s.

- **Iter_55** (2026-05-05) — **Visit-rule + Annual Targets + SOR Report on Exports + walk-in detector hardening**:
  - **Order-counting rule changed**: A "visit" is now a unique `(order_date, channel)` pair per customer. Same date AND same channel = 1 visit (multiple order_ids merge); same date, different channels = 2 visits. Affects `/api/customer-frequency`, `/api/analytics/customer-retention`, and `/api/analytics/repeat-customers`. The expanded "orders" list on the repeat-customers table now shows the rolled-up `order_id` field (comma-joined when more than one) plus an `order_id_count` badge.
  - **Annual Targets endpoint** `GET /api/analytics/annual-targets` returns 2026 quarterly targets (Kenya - Retail / Kenya - Online / Uganda / Rwanda) totalling KES 1,434,521,673, plus YTD actuals from `/country-summary`, per-quarter actuals, run-rate projection, and variance to target. Verified: total target matches finance spreadsheet exactly.
  - **AnnualTargetsCard component** with two variants:
    - `compact` — placed on the Overview page in the Insights & Projections section. 4-tile per-channel grid with progress bars + total YTD + projection.
    - `full` — placed at the top of the CEO Report page. Full per-channel table (Annual Target, YTD Actual, % YTD, Projected Year, % Projected, Gap) plus a quarterly progress matrix.
  - **SOR Report tab on Exports page** — new tab "SOR Report" with the 19 columns finance + buying ops use (Style Name, Category, Sub Category, Style Number, Sales 6M, Units Sold, Units 6M, Units 3W, SOH, SOH WH, % In WH, ASP 6M, Original Price, Days Since Sale, 6M SOR, Launch Date, Weekly Avg, Weeks of Cover, Style Age Wk). Filters (search + category + subcategory + brand multi-select). CSV export with all 19 columns. Backend `/analytics/sor-all-styles` enriched with `category` (derived from product_type) and `original_price` (modal of `/products` `product_price_kes`, fallback to gross_sales/units).
  - **Walk-in detector hardened**: `_get_customer_name_lookup` now pulls a 400-day window via `/top-customers` (not the tiny default which only returned ~1,261 rows). Detector now matches the user's ops definition: "no phone AND no email anywhere" — checked across both the `/orders` row and the roster.
  - **Verified Apr27-May4 visit-rule**: 2,032 identified customers, 176 repeaters, **8.7% repeat rate**. `/customer-frequency` and `/analytics/customer-retention` agree (276→176 after the merge). One Oasis Mall visit on 2026-04-27 has order_id="11953034527086, 11953041310062" with order_id_count=2 → 2 ids same date+same channel collapsed correctly.
  - **Tested via testing_agent (Iter_43 + 44)**: Backend 5/5 PASS, Frontend all 4 changes PASS after one fix iteration on SORReportExport (corrected MultiSelect prop name `selected`→`value` and option shape `[{value, label}]`). Final SOR Report shows 1,706 styles, all filters working, console clean.
  - **Deferred**: Inventory page "search filter applies to EVERYTHING" — current state filters charts/tables by `visibleSubcats`/`visibleStyles`/`visibleLocations`. Fully re-aggregating subcategory STS rows from style-level data when search is active still needs a focused refactor (pull `/sor` style-level data on the Inventory page and roll up filtered styles by subcategory).

- **Iter_54** (2026-05-05) — **Walk-in detection unified across Customers page**:
  - Backend: New endpoint `GET /api/analytics/repeat-customers` returns one row per identified customer with ≥ `min_orders` (default 2) **distinct order_id** in window, with a nested `orders` array (order_id, order_date, channel, total_kes, units).
  - Backend bug fix: `/analytics/customer-retention` was counting LINE-ITEMS instead of distinct orders (so a 4-SKU basket bumped the customer to "≥2 orders" wrongly, inflating repeat_customers from 273 → 1,245 on 27-Apr-04-May). Fixed to count distinct `order_id` per customer; both endpoints now agree.
  - Walk-in detector hardened:
    - `_get_customer_name_lookup` now pulls a 400-day window (was default — which only returned ~1,261 most-recent customers, missing tens of thousands of legitimate customers and falsely flagging them as walk-ins).
    - Added rule (4): "no phone AND no email anywhere" — checked across both `/orders` row AND the `/top-customers` roster. Catches POS-internal placeholder IDs like `443578` that had 38 orders all from one store.
  - Frontend: New "Repeat Customers Detail" card on the Customers page (between Loyalty Distribution and Top N) showing the 4-tile summary (Repeat customers count, Total orders, Total spend, Avg spend/customer) plus a sortable, paginated table. Each row expands to reveal its full order list (Order ID, Date, Channel, Units, Order Total). CSV export emits one row per (customer × order) so finance can pivot in Sheets.
  - Verified Apr27-May4: 2,032 identified customers (was 2,318 before tighter walk-in rule), 216 repeaters, **10.6% repeat rate**. Both `/customer-frequency` and `/analytics/customer-retention` now match exactly. Top spender: Gabriela Favour Lagum, 5 orders, KES 114,731.

- **Iter_54** (2026-05-05) — **Walk-in detection unified across Customers page (fixes Avg Spend mismatch + Repeat Purchase Rate inflated by anonymous traffic)**:
  - **Bug**: Avg Spend / Customer card showed KES 9,695 while New (KES 5,721) + Returning (KES 8,758) buckets, weighted by their customer counts (141 + 882 = 1,023), came out to ~KES 8,341. Mismatch = walk-in revenue counted in the numerator (`/kpis.total_sales` includes anonymous transactions) but excluded from the denominator (upstream `/customers.total_customers` is identified-only).
  - **Bug 2**: Repeat Purchase Rate (legacy) showed 8.2% because `/customer-frequency` upstream returns ALL customers including walk-ins, who almost always have only 1 "order" — collapsing the repeat-rate denominator.
  - **Walk-in rules per ops definition**: any of (a) no `customer_id`, (b) `customer_type=Guest`, (c) blank-name in `/top-customers` roster (~379 IDs), (d) **NEITHER phone NOR email** in roster, (e) name contains "walk", "vivo", or "safari", (f) name matches the POS / store / location name.
  - **Fix**: 
    1. Promoted module-level `_is_walk_in_order` in `server.py` to the same robust 7-rule detector used inside `/customers/walk-ins`. Now accepts optional pre-warmed `name_lookup` + `contact_lookup` params for hot-path performance.
    2. Extended `_get_customer_name_lookup()` to also build a sibling `_customer_contacts_cache` (customer_id → {has_phone, has_email}) so rule (d) can fire.
    3. Updated all four `routes/customer_analytics.py` endpoints to warm the lookups once and pass both into `_is_walk_in_order` for every row.
    4. Rewrote `GET /api/customer-frequency` to compute buckets from `/orders` with the robust walk-in filter, instead of upstream pass-through. Now honours `country` + `channel` filters too.
    5. `/api/customers` `avg_customer_spend` recompute now uses identified-only spend (sum of New + Returning totals from `/analytics/avg-spend-by-customer-type`) ÷ identified-only customer count. Source flag changed to `recomputed_local_identified`. Also overrides `total_customers` to the identified count so retention denominators align.
  - **Frontend**: updated the "Repeat Purchase Rate (legacy)" caption from "includes walk-ins · X buckets" to "walk-ins excluded · X customers". Added `country`/`channel` filters to `/customer-frequency`, `/analytics/customer-retention`, and `/analytics/avg-spend-by-customer-type` API calls.
  - **Verified Apr 2026**: `total_customers` now = 8,405 (was bigger before walk-in cleanup). New = 1,306 × 6,909 = 9.0M. Returning = 7,099 × 10,385 = 73.7M. Total = 82.7M ÷ 8,405 = **KES 9,845 avg spend** — matches the New + Returning weighted average exactly. Frequency buckets sum to the same 8,405.

- **Iter_53** (2026-05-05) — **FX conversion now handled upstream in BigQuery — all server-side FX logic removed**:
  - The upstream BI API now returns every monetary field already converted to KES (Uganda UGX→KES at 28.79, Rwanda RWF→KES at 11.27, etc.) at the data layer in BigQuery.
  - Removed from `server.py` (~555 lines): `FX_OVERRIDES`, `_FX_FIELDS_ROW`, `_fx_rate_for`, `_fx_correct_orders`, `_fx_window_rate`, `_fx_apply_aggregate`, `_fx_correct_country_scoped`, `_fx_split_window`, `_fetch_kpis_with_fx_split`, `_fetch_rows_with_fx_split`, `_fx_correct_rows_per_country`. Endpoint `/api/admin/fx-overrides` removed.
  - Simplified `/kpis`, `/sales-summary`, `/country-summary`, `/daily-trend`, `/top-skus`, `/sor`, `/subcategory-sales`, `/subcategory-stock-sales`, `/top-customers`, `/analytics/category-country-matrix` — they now pass upstream KES values straight through.
  - Disk-persisted stale cache wiped (`/tmp/_kpi_stale_cache.json`) so old pre-correction values do not leak.
  - Verified May 2026: Uganda 736,648 KES total_sales (matches Vivo Acacia 568,812 + Oasis Mall 167,836). Rwanda 682,431 KES (Kigali Heights). All-countries KPI = 12,635,691 KES with no double-counting / no inflation.

- **Iter_52** (2026-05-05) — **/country-summary FX bug fix** (the "Country split" chart showed Uganda 21M, Rwanda 7.5M):
  - Root cause: my iter_49 refactor wired `/country-summary` through a per-country fan-out, but upstream's `/country-summary` IGNORES the `country` query param — it always returns all 4 countries. So each fan-out call got the full payload, and FX was applied to ALL rows (Kenya, Uganda, Rwanda, Online) with whichever country's rate the slice was for, before a "last-writer-wins" merge produced nonsense.
  - Fix: one single upstream call (as it should have been), then per-row correction using each row's own `country`. For straddling windows I make ONE extra call for the post-boundary sub-window only, derive pre = full − post_raw, FX-correct post, sum pre + corrected_post, and recompute `avg_basket_size` from the merged orders/total_sales.
  - Verified May 1-4: Uganda 736,648 KES (was 21.2M), Rwanda 671,695 KES (was 7.57M). Straddle 27 Apr → 3 May: Uganda 1.33M, Rwanda 0.88M. Pre-boundary April untouched.

- **Iter_51** (2026-05-05) — **Stock to Sales — Products Plan report**:
  - New tab on the Products page: `/products?tab=products-plan` (data-testid `subtab-products-plan`).
  - New backend endpoint `GET /api/analytics/products-plan` returns one row per subcategory with:
    - `category`, `subcategory`, `total_sales`, `sor`
    - `qty_sold` + `pct_qty` (share of window-wide units sold)
    - `total_soh` + `pct_total_soh` (share of group total SOH)
    - `stores_soh` + `pct_stores_soh` (share of store SOH)
    - `wh_soh` + `pct_wh_soh` (share of warehouse SOH)
  - Sales honour `country` + `channel` filters; under a POS channel we switch to `/orders`-aggregated sales (upstream's `/subcategory-sales` is unreliable under POS filters). Warehouse SOH always group-wide so it reflects total allocable backstock.
  - Frontend component: sortable, CSV-exportable, mobile-card layout, with SOR pill colouring (red <20, amber 20-30, green ≥30) and a 5-tile "Totals" strip at the bottom summarising the % denominators (total sales, qty, group SOR, stores SOH, W/H SOH) so users can validate the math at a glance.
  - Verified Apr MTD: 32 rows; Knee-Length Dresses lead at 17.2% of qty sold and 20.3% of stores SOH. All three % columns sum to ~100% (rounding).

- **Iter_50** (2026-05-05) — **IBT enhancements + bins sheet refresh + WOC semantics + SOR L-10 tighter filter**:
  - **IBT — export with color & size**: new "Export with color & size" button on IBT page. Fetches the SKU breakdown for every visible suggestion in parallel (cap 6 concurrent), flattens to one CSV row per (suggestion × suggested-SKU) with color, size, from/to SOH, suggested qty, and pro-rata revenue uplift.
  - **IBT — Expand-all / Collapse-all**: `SortableTable` now exposes a top-of-table toggle when `renderExpanded` is set. Labels flip to "Collapse all" when every row is open.
  - **IBT — Warehouse → Store suggestions**: new endpoint `GET /api/analytics/ibt-warehouse-to-store` + new `WarehouseToStoreIBT` section on the IBT page. Surfaces (style × store) pairs where the store is selling AND shop-floor SOH < 3-day safety floor, with matching warehouse stock. Suggested move fills to 4-week cover, capped by warehouse availability. Sortable by missed-sales risk score. Verified: returns real candidates (e.g. Wrap Poncho shop-zetu: 137/wk velocity, wh=206, suggest 33).
  - **Weeks of Cover — ideal is 12 weeks**: the WOC column on both the STS subcategory table and the aging table now renders < 12w as RED, 12–26w as AMBER, > 26w as GREEN (was: < 2 red, ≤ 4 amber). Tooltip updated.
  - **stockScope applies to WOC too**: `GET /api/analytics/weeks-of-cover` now accepts `stock_scope` (stores / warehouse / combined). Sales ALWAYS come from stores (warehouses don't sell) — only the `current_stock` numerator changes. Verified: Tank Top → warehouse-scope WOC 1.77w (wh=227 units), stores-scope WOC 5.39w (stores=693 units); velocity identical (128.5/wk) across both.
  - **Aged Stock on Inventory page**: `AgedStockReport` component rendered on the Inventory page as well as Re-Order. Already supports 30/60/90/180 presets plus custom numeric input (0-365 days), POS filter, product search.
  - **SOR L-10 filter 20 → 50**: `(units_6m + soh_total) >= 50` now applied server-side. L-10 list drops from 18 rows to 16; removes weak runners from buyer attention. CSV exports also honour the new threshold.
  - **Bins sheet migrated**: `bins_lookup.py` GID updated to `1405111046` (new 2-col `BARCODE,LOCATION` layout). Parser auto-detects 2-col vs legacy 6-col (step-of-4) rows. H-prefix bins still excluded. Verified: loaded 7,850 entries.

- **Iter_49** (2026-05-04) — **FX correction now handles straddling custom date ranges**:
  - Bug: a custom range like 27 Apr → 3 May 2026 (straddling the May 1 FX boundary) showed Vivo Acacia at KES 11.78M and Vivo Kigali Heights at KES 4.90M — local-currency UGX/RWF values weren't being divided. Root cause: my `_fx_window_rate` returned `None` for any window starting before the override `start`, so the entire straddling window inherited "no FX".
  - Fix: new `_fx_split_window(country, df, dt)` returns 1 or 2 `(df, dt, rate)` slices. Straddling windows get split into a pre-boundary slice (`rate=None`, no correction — pre-May data was already in KES upstream) and a post-boundary slice (`rate=28.79` or `11.27`, divided per row).
  - Two new aggregation helpers wired into `/kpis`, `/sales-summary`, `/country-summary`:
    - `_fetch_kpis_with_fx_split` — fetches both halves in parallel, FX-corrects post, and re-aggregates via `agg_kpis` (recomputes weighted ABV / ASP / return-rate cleanly).
    - `_fetch_rows_with_fx_split` — fetches both halves, FX-corrects post per-row, sum-merges by `(channel, country)`, and recomputes `avg_basket_size` post-merge as `total_sales / orders` (averaging two pre-computed AOVs would be wrong).
  - `/daily-trend` already iterates per-day-row so it gets straddling correct for free; updated only the no-country-filter fanout guard to trigger when ANY slice touches an override (was: only when whole window is post-boundary).
  - Verified Apr 27 → May 3:
    - Vivo Acacia: 441,195 (Apr 27-30, no FX) + 393,717 (May 1-3, ÷28.79) = **834,912 KES** ✓ (was 11,776,295)
    - The Oasis Mall: 364,363 + 131,817 = **496,180 KES** ✓
    - Vivo Kigali Heights: 491,216 + 390,772 = **881,988 KES** ✓ (was 4,895,216)
    - Order counts sum exactly: Acacia 40+42=82, Oasis 25+18=43, Kigali Heights 36+29=65.

- **Iter_48** (2026-05-01) — **FX correction now also covers the "All countries" view** (KPI cards bug):
  - Bug: Overview KPI cards (Total Sales, Net Sales, etc.) did NOT show the corrected values when "All countries" was selected. They called `/kpis` with no `country` param, so upstream returned the global aggregate that sums UGX + RWF + KES as if they were the same currency — inflating May 1 from the correct ~3.4M to a fake **7.61M**.
  - Fix: in `/kpis` and `/daily-trend`, when the request has NO country filter AND any FX override is active for the requested window, force a per-country fan-out across `["Kenya", "Uganda", "Rwanda", "Online"]`. Each per-country payload is FX-corrected before aggregation. When NO override is active (e.g. April or earlier), the cheap single upstream call is used as before.
  - Verified: May 1 (no country filter) now returns **3,437,091 KES** (was 7,607,883). Matches per-country sum. Warm cache is idempotent (no double-correction). April requests still take the fast single-call path (1.1s).

- **Iter_47** (2026-05-01) — **FX overrides for Uganda & Rwanda (April 2026 onward)**:
  - Vivo BI started returning sales in local currencies (UGX / RWF) for these two countries from 2026-04-01 — dashboard tiles were showing huge inflated numbers.
  - Hard-coded overrides: `Uganda → ÷28.79`, `Rwanda → ÷11.27`, `start: 2026-04-01`. (Configured in `FX_OVERRIDES` dict in `server.py` — bump and redeploy when rates change.)
  - **Per-row correction inside `fetch()`** for `/orders` — every monetary field (`total_sales`, `net_sales`, `gross_sales`, `unit_price`, `subtotal`, `discount`, `revenue`, `amount` and their `_kes` variants) is divided by the country/date-appropriate rate before the row enters the response cache. Mutation is safe because correction happens BEFORE the cache write — subsequent cache hits return already-correct values without re-correcting.
  - **Wrapper-level correction** for aggregated endpoints `/kpis`, `/sales-summary`, `/country-summary`, `/daily-trend`. These call `fetch()` (which caches the RAW upstream payload), so the wrapper SHALLOW-COPIES rows before applying FX — never mutates the cached upstream dict (otherwise repeat callers would compound the division and drift toward 0).
  - **Per-day boundary check** in `/daily-trend`: even multi-month windows correctly correct only the override-period days, leaving pre-2026-04-01 days untouched.
  - **Multi-country `/kpis` fan-out** corrects each per-country payload BEFORE aggregation, so KE + UG + RW combine cleanly in KES (verified: 77.9M + 0.27M + 0.30M = 78.69M ✓).
  - **Field allow-list** (`_FX_FIELDS_ROW`) covers the full set of upstream sales / monetary fields including `avg_basket_size`, `aov`, `discounts`, `returns` so derived columns line up with the corrected `total_sales` in the same row.
  - **New ops endpoint** `GET /api/admin/fx-overrides` — returns the active config (rates + start dates + corrected fields).
  - Verified Apr MTD: Uganda total_sales = **264,872 KES** (avg basket 450 KES), Rwanda = **295,028 KES** (avg basket 1,046 KES). Kenya & Online unchanged. Round 1/2/3 warm-cache hits return identical values (no double-correction).

- **Iter_46** (2026-05-01) — **Circuit breaker + auto-recovery** (fixes the "super slow / stale 68 min ago" UX during real upstream outages):
  - **Backend circuit breaker** in `fetch()`: after 2 consecutive 5xx / timeout failures on an upstream path-prefix (e.g. `/orders`, `/kpis`, `/footfall`), the breaker OPENS and fails fast for 30 s. Subsequent requests raise in <50 ms instead of paying 15 s × 3 attempts = 45 s of timeouts → endpoints fall straight through to their 24 h disk-backed stale cache. After 30 s, one probe is allowed (HALF state); success closes, failure re-opens.
  - **Background recovery loop** (60 s tick): if any breaker is open OR `_kpi_stale_cache` has any entry older than 5 min, force-close breakers, probe `/kpis` against upstream. On success, re-warm the hot path (today + MTD + last-30d /kpis, /country-summary, /footfall, /sales-summary) so the stale banner clears within ~60 s of upstream actually recovering — no user action required.
  - **Frontend auto-poll** in `useKpis`: while a payload comes back with `stale: true`, silently re-fetch every 30 s in the background. As soon as the backend serves fresh data the staleness banner disappears, no page refresh needed.
  - **New admin endpoints** for ops debugging: `/api/admin/circuit-breaker` (current state — open paths, fail counts) and `POST /api/admin/circuit-breaker/reset` (force-close everything).
  - **Why this matters**: before this change, when Vivo BI was actually down for an hour, every Overview tile request paid 45 s of timeouts before falling back to stale — even though the stale data was right there. With 20 + tiles fanning out concurrently the user perception was "the dashboard is broken". Now the stale fallback hits in <50 ms, AND the dashboard self-heals within 60 s of upstream recovery.

- **Iter_45** (2026-04-30) — **Accurate ages on All-Styles SOR + backend-side L-10 noise filter**:
  - **Bug fix · All-Styles SOR `style_age_weeks` / `launch_date` / `weekly_avg` / `days_since_last_sale`**: these 4 columns were hardcoded (26.0 / null / units_6m÷26 / 0 or 22 heuristic) regardless of the style's real age. Example: "Vivo Tanda Maxi Dress in Ponte" showed 26.0 weeks when its real age is 8.3 weeks (launched 2026-03-03).
  - Added new shared helper `_get_style_first_last_sale(country, channel, days=180)` that returns `{style_name: (first_sale_iso, last_sale_iso)}`. It piggybacks on `_curve_cache` (populated by `analytics_new_styles_curve`, warmed at startup with `days=180`) — zero new upstream calls on the hot path. Falls back to a bounded /orders chunked fan-out only when the curve cache is cold.
  - `/sor-all-styles` now uses this helper to compute **real** `style_age_weeks` (capped at 26), **real** `launch_date`, **real** `days_since_last_sale`, and a **real-age-based** `weekly_avg`. Coverage: **1,670 / 1,697 styles (98%)** have accurate ages; only styles older than 180 days still report 26.0.
  - **Perf**: cold→warm /sor-all-styles dropped from **>60s timing out → 0.26s**.
  - **Startup warmup reordered**: curve + bins run first (~15s), THEN sor-all-styles + replenishment run in parallel (~20s). Previously they ran in parallel and sor-all-styles raced the curve cache it now depends on.
  - **L-10 filter moved to backend**: `(units_6m + soh_total) >= 20` is now applied in `/sor-new-styles-l10` (was frontend-only). CSV exports and any third-party consumer now get the de-noised list. Frontend filter removed (map stays for category enrichment).
  - Verified: Tanda Maxi Dress in Ponte now shows `style_age_weeks=8.3, launch_date=2026-03-03, days_since_last_sale=2, weekly_avg=23.9, woc=12.6`. L-10 regression clean — same band (12.9–17.4 wks) preserved.

- **Iter_44** (2026-04-30) — **Cold-load resilience + general perf pass**:
  - **Root cause**: Overview's "Upstream KPIs unavailable (Network Error)" banner fired when the upstream Vivo BI Cloud Run container was cold and the per-attempt budget (30s × 2 attempts) plus k8s ingress timeout combined to exceed the browser's patience, OR when the in-memory stale cache (3-min TTL) had already expired before the upstream came back online.
  - **Backend fixes**:
    - `_kpi_stale_cache` TTL extended **3 min → 24 h** and now **persisted to disk** (`/tmp/_kpi_stale_cache.json`) so a pod restart no longer wipes the safety net.
    - Disk flush is serialised via `_kpi_stale_save_lock` (`asyncio.Lock`) so concurrent fire-and-forget saves don't race on the tmp→final rename.
    - `/kpis` per-attempt budget **30s → 15s × 3 attempts** (45s total) — fails faster into the stale fallback, well inside the ingress timeout.
    - Same stale-cache pattern (15s × 3 attempts, 24-h disk-backed fallback) applied to `/country-summary`, `/sales-summary`, `/footfall`, `/daily-trend` — every Overview-page hot endpoint.
    - **Startup hot-path warmup**: 72 background tasks pre-populate `/kpis` + `/country-summary` + `/sales-summary` + `/footfall` + `/daily-trend` for {Today, Yesterday, Last 7d, Last 30d, MTD, Last Month} × {Kenya, Uganda, Rwanda, Online, no-country} on boot — so the FIRST user click after a deploy hits warm cache.
    - On rehydrate, the 24-h disk cache is loaded into memory before the warmup runs, so pod restarts inherit ALL prior cached values.
    - `/admin/cache-clear` now **preserves** `_kpi_stale_cache` (was clearing it). The stale cache is a safety net, not a freshness cache — wiping it on user-triggered Refresh defeats its purpose. Only `_FETCH_CACHE`, inventory, and churn caches are cleared on Refresh now.
  - **Frontend fixes**:
    - `RESP_TTL_MS` (axios response cache) bumped **5s → 60s** — re-navigating between pages now re-uses identical KPI/sales/inventory payloads instead of re-hitting the upstream every time.
    - `refresh()` in `filters.jsx` now also calls `clearApiCache()` so the new 60-s window doesn't mask a manual Refresh.
  - **Verified**:
    - 14-call parallel cold-cache wave completes in 5.3s wall-time (most calls <2s).
    - Cold `/api/kpis` returns in **1.05s** (was timing out cold previously).
    - Overview screenshot post-fix: 11 KPI tiles populated, no `degraded-banner`, all charts render.
    - `_kpi_stale_save_async` lock eliminated all "stale-cache flush failed" race-condition warnings in supervisor logs.

- **Iter_43** (2026-04-30) — **P0 visibility fix + P1 refactor pass 1**:
  - **Fix · Inventory STS Stock toggle visibility**: the `[data-testid='inv-stock-scope']` Stores/Warehouse/Combined toggle was wrapped inside `{(countries.length > 0 || channels.length > 0) && …}` so it stayed hidden until the user applied a filter. Moved it (and the warehouse-include checkbox) into an unconditional `inv-filter-row` so the controls are always visible right under the page title. Banner ("Showing inventory for: …") still stays conditional on `filtersActive`. Verified via screenshot.
  - **Refactor · server.py extraction pass 1**: `server.py` reduced from **6,095 → 5,520 lines**. Created a new `/app/backend/routes/` package and extracted:
    - `routes/customer_analytics.py` (368 lines, 4 endpoints): `/api/analytics/customer-details`, `/api/analytics/customer-retention`, `/api/analytics/avg-spend-by-customer-type`, `/api/analytics/recently-unchurned`.
    - `routes/analytics_inventory.py` (285 lines, 2 endpoints): `/api/analytics/replenish-by-color`, `/api/analytics/aged-stock`.
  - **Pattern documented in `routes/__init__.py`**: each submodule does a `from server import api_router, …helpers…` and is itself imported at the BOTTOM of `server.py` (after all helpers are defined, before `app.include_router(api_router)`). Late import sidesteps the circular-import trap while keeping registration ergonomic.
  - Verified: `/api/analytics/customer-retention` (55.28% repeat rate, 8264 customers, 48 walk-ins), `/api/analytics/avg-spend-by-customer-type` (New 6,875 vs Returning 10,401 KES), `/api/analytics/customer-details`, `/api/analytics/replenish-by-color` all return live data; `/api/locations`, `/api/kpis`, `/api/sor`, `/api/health` regression-tested OK.

- **Iter_41** (2026-04-30) — **Major feature drop (12 items, 4 phases)**:
  - Phase 1 (Quick UX wins): (a) Collapsible Category accordion on Stock-to-Sales by Subcategory tables (Inventory + Products) via new `CategoryAccordionTable.jsx` + `Flat ↔ Grouped` view toggle. Header rows show aggregated totals; rows ranked by units_sold desc within each group. (b) SOR · L-10 New Styles now excludes any row where `(units_6m + soh_total) < 20`. (c) Style names line-clamped to 2 lines with full text on hover (CSS `-webkit-line-clamp:2`). (d) Cat / SubCat MultiSelect filter pills on Inventory + Products driven by static `MERCH_CATEGORIES` / `subcategoriesFor()` helpers in `productCategory.js` — instant, no extra fetch.
  - Phase 2 (Customer analytics): (a) `/api/analytics/customer-retention` excludes walk-ins (no customer_id OR customer_type=Guest) → repeat rate jumped from bogus ~6% to truthful ~55%. (b) `/api/analytics/avg-spend-by-customer-type` New vs Returning twin-tile using upstream's `customer_type` field (no costly historical fan-out). (c) `/api/analytics/recently-unchurned` with `min_gap_days` slider (30/60/90/180) — customers who came back after a long silence.
  - Phase 3 (New reports + perf): (a) Aged Stock Report on Re-Order page (`/api/analytics/aged-stock`) with day-threshold toggle, POS dropdown, search box, columns POS·Product·Size·Barcode·Units Sold (180d)·SOH·SOH WH·Days Since Last Sale. (b) Replenishment by Color report (`/api/analytics/replenish-by-color`) — SOR ≥ 50% + WoC < 8 wk → recommended replen qty per color from `(last_30d_units / 30) × 56 days − soh`. Cheap 30-day single fan-out (not 6-month per-style). (c) Bulk SKU breakdown endpoint `/api/analytics/style-sku-breakdown-bulk` for SOR table +Color/+Size — 25 styles in one fan-out instead of 25.
  - Phase 4 (New pages): (a) `/customer-details` page with first/last name, opt-in flags ("n/a" until upstream exposes), email, mobile, total_sales, first/last order — Cat/SubCat/POS/date filters. (b) KPI Trend Line Chart on Overview (KPI dropdown × line per country).
  - Reliability: `_orders_for_window` now tolerates per-chunk upstream 503s and returns partial results instead of cascading 500s. Startup warm-up pre-loads MTD + last-30 customer-history cache so first user click never crosses ingress timeout.
  - Tested via `testing_agent_v3_fork` iter_41 — 7/9 backend, 10/12 frontend testids verified. Repeat rate 55.2% confirmed live (matches spec). Two missing testids (sts-view-flat/grouped and unchurned-count) shown to be present in the code but render conditionally — not real bugs. Cold-cache 502s addressed by partial-result tolerance + startup warm-up.
- **Iter_40d** (2026-04-30) — **Per-country stock on Stock-to-Sales tables**:
  - User reported "The inventory shows for all business, it does not filter by country or POS". Confirmed upstream Vivo BI `/subcategory-stock-sales` returns per-country SALES but **GLOBAL STOCK** — every country query got identical `current_stock` values (e.g. Dresses=9,600 for Kenya, Uganda AND Rwanda).
  - Previous logic only re-scoped stock when `locations` (POS) was set. Country-only queries passed through upstream's buggy global stock unchanged.
  - Fix: added `elif cs:` branch in `analytics_sts_by_subcat` (~line 2355) and a parallel `if locs or cs` guard in `analytics_sts_by_category` (~line 2482). Both now call `fetch_all_inventory(country=country)` and rebuild `stock_by_subcat` from the country-scoped inventory.
  - Verified with 11/11 backend tests + frontend: Kenya Dresses = 6,135 units / 20,501 stock; Uganda = 538 / 1,773; Rwanda = 207 / 985 (all distinct). No-country call preserved as upstream pass-through. POS+country still narrows correctly.
- **Iter_40c** (2026-04-29) — **Path-aware country case normalization (final fix)**:
  - User reported by-Color and by-Size tables still zero under country filter, even after iter_40b fixed by-subcategory. Root cause: upstream Vivo BI API has **mixed case-sensitivity** — `/orders`, `/sales-summary`, `/daily-trend`, `/top-customers`, `/subcategory-sales`, `/subcategory-stock-sales` REQUIRE Title-case (`Kenya`); but `/inventory` REQUIRES lowercase (`kenya`); `/locations`, `/country-summary`, `/kpis` are case-insensitive. Iter_40b only patched the two subcategory endpoints; a global Title-case attempt then broke `/inventory`.
  - Fix moved to a single choke-point in the `fetch()` wrapper (~line 165): `if path.startswith('/inventory') → lowercase, else → Title-case` via new `_norm_country` / `_norm_country_csv` helpers. Handles CSV (`kenya,uganda` → `Kenya,Uganda`). Cache key uses post-normalization params, so de-dup still works correctly.
  - Verified via 16/16 backend pytest + UI screenshot: under Country=Kenya the Inventory page now shows non-zero **UNITS SOLD AND INVENTORY** in all 4 STS tables (Category, Subcategory, Color, Size), top KPIs (Stock on Hand, WoC, etc.) still populated, and `/kpis` / `/country-summary` regressions pass. Online correctly shows units > 0 / stock = 0 (no warehouse).
- **Iter_40b** (2026-04-29) — **Stock-to-Sales country case-sensitivity hotfix**:
  - User reported that Stock-to-Sales tables still showed 0 units sold even when picking only a country (no POS). Root cause: the frontend lowercases country codes to `kenya`/`uganda`/`rwanda`, but the upstream `/subcategory-stock-sales` and `/subcategory-sales` endpoints silently return `units_sold=0` when country isn't Title-case (`Kenya`/`Uganda`/`Rwanda`). Stock side worked because `current_stock` came from the case-insensitive `fetch_all_inventory`, so the table looked half-broken (inventory populated, units_sold zero).
  - Fix: added `_norm_country` / `_norm_country_csv` helpers (`{kenya→Kenya, uganda→Uganda, rwanda→Rwanda, online→Online}`) and applied them in `get_subcategory_sales` and `get_subcategory_stock_sales` before forwarding. Verified: `country=kenya` (today) now returns 65/45/44 units for top subcats (was 0), `country=uganda` 7/4/3, multi-country `kenya,uganda` aggregates correctly.
- **Iter_40** (2026-04-29):
  - **Q2 Targets card on Overview** [`[data-testid='q2-targets-card']`, mounted in the bottom "Insights & Projections" section]: 5 KPI tiles — Kenya · Rwanda · Uganda · Online · Overall — each with progress ring, achieved KES (compact), target, projected landing, and Q2 days-left. Targets: Kenya 269M / Rwanda 12M / Uganda 28M / Online 24M / Overall 333M (sum). Pace-based projection = `achieved_to_date / days_elapsed × 91`. Ring color: green ≥100%, amber 70–99%, red <70%. **Filter-independent**: card calls its own `/country-summary?date_from=2026-04-01&date_to=2026-06-30` and never reads global FilterContext, so date / country / POS changes don't affect it. Verified at UI level by swapping country filter — all 5 tile values stay identical. Overall tile uses dark-green gradient styling to differentiate.
  - **Inventory Stock-to-Sales POS-zero bug FIXED**: upstream `/subcategory-stock-sales` and `/subcategory-sales` silently drop sales (units_sold=0) when a `channel=<POS>` value is passed for many Kenya stores, or when a CSV is passed at all. New helper `_subcategory_sales_from_orders()` aggregates `/orders` by `subcategory` (chunked ≤30 days, per-country/per-loc filtered, returns excluded). When `locations` is set, both `analytics_sts_by_subcat` and `analytics_sts_by_category` now override units_sold / total_sales / orders from this helper. Verified: 2-POS Kenya filter now returns 28 subcat rows / 621 total units (was zeros pre-fix). by-attribute (color/size) already used `/orders`, so unaffected. 6/6 backend pytest pass.

- **Iter_39f** (2026-04-29):
  - **sale_kind audit complete** — Walk-in endpoint was the only other `sale_kind == "order"` consumer that silently dropped Kenya rows. Fixed; full audit (`grep sale_kind`) shows no remaining strict filters.
  - **Walk-in detection rebuilt around the real signal**: customer_name is NOT exposed by `/orders` and customer_id is never null in the data. Built `_get_customer_name_lookup` that pulls `/top-customers` (~7,800 rows, 6h cache) and discovered the actual walk-in marker: **379 customer IDs with BLANK names**. Including these jumped detection from 2 / 2,819 (0.07%) → **232 / 2,819 (8.23%)** with a realistic per-store distribution. Detection now layers: null cid · type=guest/walk-in · roster-blank-name · name contains walk/vivo/safari/store-name.
  - **Replenishment owner re-sort**: now contiguous-block per store (alphabetical) — each owner gets a continuous walk through their store cluster instead of zig-zagging. Matthew 12 stores / 668u, Teddy 9 stores / 427u, Alvi 5 stores / 455u, Emma 3 stores / 267u (some imbalance preserved to keep stores intact for one operator).
  - **Cat column on Products → Stock-to-Sales by Subcategory**: added as the leading column, matching the Inventory page version.

- **Iter_39e** (2026-04-29):
  - **Critical fix — Kenya was being silently dropped**. Kenya orders use `sale_kind = "sale"` but Uganda/Rwanda use `sale_kind = "order"`. The previous filter `(r.get("sale_kind") or "order") != "order"` rejected ALL 4,600+ Kenya orders. Now accepts any kind that isn't a return/exchange/refund. Result: 7-day report jumped from **72 rows / 99 units (Uganda+Rwanda only)** → **1,274 rows / 1,817 units across 29 stores in all 3 countries**.
  - **Country fan-out fixed**: upstream `/orders` defaults to Uganda when country is omitted. Backend now explicitly fans out across `["Kenya", "Uganda", "Rwanda"]` (Title-cased per upstream contract, was lowercase which silently 0'd) with a 4-call concurrency cap to dodge upstream 503 rate limits.
  - **`Country` column** added to the report (per-POS, sourced from a `loc_country` map, NOT per-SKU — fixes a bug where shared SKUs gave wrong country labels). Pill-styled, matches the Country filter look.
  - **`SOH Store` column** added (current shop-floor stock for that SKU at that POS); 0-stock rows render in red bold so urgent picks pop.
  - **Filter**: `units_sold > 0` per (POS, SKU) — confirmed.

- **Iter_39d** (2026-04-29):
  - Filter restored to **units sold > 0** per (POS, SKU) (was > 1). Subtitle + empty-state copy updated.
  - 502 root cause: backend hot-reload had cleared the in-memory cache; the startup warmup populates it within ~90 s — verified post-warmup. 7-day window: 72 rows / 99 units · owner balance 25/25/25/24 across 3 stores (Oasis Mall, Vivo Acacia, Vivo Kigali Heights).

- **Iter_39c bundle** (2026-04-29):
  - **Replenishment v3 — fixed scope & balance**: (1) **Online channels excluded** entirely (`_is_online_channel` matches "online", "ecom", "shop-zetu", "shopify") — replenishment is a physical pick-and-pack op, online has no shop floor. (2) Filter restored to **units sold > 1** per (POS, SKU). (3) **Owner balancing now per-LINE** (not per-store): a single store can be co-owned by 2-3 owners; one owner can carry multiple stores. Greedy bin-packing assigns each line to the lowest-load owner, anchoring on biggest lines first. Verified: 7-day window at Vivo Acacia → 5 lines / 9 units → Matthew 3 / Teddy 2 / Alvi 2 / Emma 2 (1-unit spread, vs the previous 68 / 7 / 2 / 0 single-store skew).

- **Iter_39 bundle** (2026-04-29):
  - **Daily Replenishment Report** [Exports → new "Daily Replenishment" tab `[data-testid='exports-tab-replen']`]: 10-column report (Owner · POS · Product · Size · Barcode · Bin · Units Sold · SOH WH · Replenish · Replenished). Rules: replenish when shop-floor stock < 2 AND units sold > 0 in window, target = 2 units, WH FG stock > 1 (never strips warehouse). Stores split across 4 owners (Matthew/Teddy/Alvi/Emma) via greedy bin-packing; ties broken by 6-month sell-through rank (4h cached). **Date-range picker** (From/To) — both default to yesterday. Each row has a **Mark replenished** toggle that persists per (date_from, date_to, pos, barcode) in MongoDB `replenishment_state` and re-overlays on every fetch. Backend: `/api/analytics/replenishment-report` (30-min cached) + `/api/analytics/replenishment-report/mark` (POST) + `/api/admin/refresh-bins`. Verified: 47 rows / 77 units yesterday; 348 rows / 547 units across the last 7 days; mark/unmark round-trips.
  - **Bins loader** (`bins_lookup.py`): fetches public CSV from the Google Sheet stock take, parses 3 column-pairs → 9,164 barcode→bin entries (1,927 H-prefixed bins skipped per business rule), caches in-process 24 h.
  - **Walk-in fix**: `_is_walk_in()` in `/api/customers/walk-ins` now also flags rows whose `customer_name` contains "walk in"/"walkin"/"walk-in" OR matches a POS location name verbatim, in addition to the existing null-customer-id and customer_type rules.
  - **Category column**: confirmed already present on Inventory · Stock-to-Sales by Subcategory.

- **Iter_38 bundle** (2026-04-29):
  - **Mobile snapshot for Overview KPIs**: New `[data-testid='open-snapshot-btn']` pill in the Overview header opens a fixed full-screen overlay (`OverviewSnapshot.jsx`, `[data-testid='overview-snapshot']`) showing every headline KPI in a single-screen, screenshot-friendly layout. 11 KPI tiles in a 2-col grid (Total Sales · Net Sales · Total Orders · Total Units · Footfall · Conversion · ABV · ASP · MSI · Return Rate · Return Amount) + a 3-col highlight strip (Top Subcat · Top Location · Best Conversion). Each tile shows label, value, and the vs-comparison delta arrow + %. Drill-down actions, prev-value sub-lines, and formula tooltips are stripped per the spec. Total content height ≈ 580 px → fits on any modern phone in a single screenshot. Close button restores the regular dashboard.

- **Iter_37 bundle** (2026-04-29):
  - **CSV %**: `SortableTable.exportCSV` now auto-detects percentage columns by sampling the first row's rendered text against `/(%|\bpp|\bpts?)\s*$/i`. When matched, the cell value is normalised to `XX.XX%` — `pp` and `pts` are stripped and `%` is appended, including when the column has a legacy explicit `csv: (r) => r.x?.toFixed(2)` callback returning a bare number.
  - **`% Understocked Subcats` KPI** [Inventory]: New `[data-testid='inv-kpi-understocked-pct']` tile in the top KPI grid (widened lg:grid-cols-5 → grid-cols-6).
  - **Role-based page access**: viewer / store_manager / analyst / exec / admin maps in `lib/permissions.js` mirror `auth.py::ROLE_PAGES`. Sidebar filters tabs; ProtectedRoute redirects unauthorised hits.


  - **CSV %**: `SortableTable.exportCSV` now auto-detects percentage columns by sampling the first row's rendered text against `/(%|\bpp|\bpts?)\s*$/i`. When matched, the cell value is normalised to `XX.XX%` — `pp` and `pts` are stripped and `%` is appended, including when the column has a legacy explicit `csv: (r) => r.x?.toFixed(2)` callback returning a bare number. Verified end-to-end via the testing agent (5/5 backend pass, all main % columns and Variance columns now export with `%`).
  - **`% Understocked Subcats` KPI** [Inventory]: New `[data-testid='inv-kpi-understocked-pct']` tile in the top KPI grid (widened lg:grid-cols-5 → grid-cols-6). `(count where pct_of_total_sold − pct_of_total_stock > 3) / total subcats`. Sub-text shows `X of Y subcats · variance > 3 pp`. Action button scrolls to the existing `understocked-subcats` table.
  - **Role-based page access**: New `/app/frontend/src/lib/permissions.js` mirrors `auth.py::ROLE_PAGES`. Maps roles → page IDs:
    - `viewer` → Overview, Locations, Footfall, Customers
    - `store_manager` → above + Inventory, Re-Order, IBT
    - `analyst` → above + Products, Pricing, Data Quality
    - `exec` → above + CEO Report, Exports
    - `admin` → everything + Users + Activity Logs
    `Sidebar` filters its tabs via `canAccessPage(user, t.id)`. `ProtectedRoute` accepts a `pageId` prop and redirects unauthorised hits to `homePageFor(user)` — so a viewer hitting `/inventory` lands back on `/`. `/api/auth/login` and `/api/auth/me` both echo `allowed_pages` so the frontend has the canonical list on first hit. Test viewer seeded: `viewer@vivofashiongroup.com / Viewer!2026`.

- **Iter_36 bundle** (2026-04-28):
  - **Phase 2a · Stock-to-Sales · by Color & by Size** [Inventory]: TWO new variance tables (`[data-testid='sts-by-color-table']` + `[data-testid='sts-by-size-table']`) placed right under the existing `Stock-to-Sales · by Subcategory` table. Identical column shape (Units Sold · Inventory · % of Total Sales · % of Total Inventory · Variance · Risk Flag) and identical pill colour-coding via `varianceStyle`. Sorted by variance magnitude desc so the worst stockout / overstock risks surface at the top. Backed by ONE shared call to the new `/api/analytics/stock-to-sales-by-attribute` endpoint (returns `{by_color, by_size}`) with a 5-min cache.
  - **Phase 2b · New Styles · Sales Curve** [Products → new sub-tab `[data-testid='subtab-sales-curve']`]: Frontend wired to the existing `/api/analytics/new-styles-curve?days=…` backend. Day-window selector (60 / 90 / 122 / 180 / 365), trend filter (All / Climbing / Plateau / Declining with live counts), live-search by style/brand/subcategory. Each row gets a 110×32 sparkline (Recharts `AreaChart`) of weekly units since launch + a trend pill. Click "Open" → larger LineChart with a peak ReferenceLine and tooltip showing units & week_start. Lets merch re-order while a style is still climbing or plateaued; markdown-flag declining ones.
  - **Cold-start fix**: Added a 30-min in-process `_curve_cache` to `/api/analytics/new-styles-curve` and a fire-and-forget startup warmup task that pre-warms `sor-all-styles` + `new-styles-curve(days=122)` so the FIRST user click no longer crosses the 100s ingress timeout. Cached endpoint now returns in **329 ms** (was timing out cold). Trend rule was tightened to use last-2-week mean vs peak (more robust when a fresh week hasn't booked yet).

- **Iter_35 bundle** (2026-04-27):
  - **SOR All Styles** sub-tab on Products: every style with sales in the last 6 months, same column shape as L-10. Tiles: Styles in Catalog / 6M Sales / Stock on Hand / Avg SOR / Slow Burners. Backed by new `/api/analytics/sor-all-styles` (30-min cached).
  - **Reusable `SorStylesTable`**: refactored from `SorNewStylesL10` so L-10 + All-Styles share one component. Adds **+ Color/Print** and **+ Size** toggle pills. When ON, each style row splits into one row per SKU variant via lazy `/api/analytics/style-sku-breakdown` (cached 30 min). Both ON → one row per individual SKU.
  - **Style-name search box** on both SOR tabs (multi-word AND, case-insensitive).

## Recently Shipped (2026-04-26 / 27)
- **Iter_34 bundle**:
  - **Δ Conversion fix** (Locations · Footfall & Conversion table): page now fan-outs a second `/footfall` call for the previous period and joins on `prevFootfallMap`, so the per-store conversion delta in pp populates instead of showing blank dashes.
  - **⌘K search perf**: timeboxed `/customer-search` to 1.2 s in `/api/search`, skipped it for queries < 3 chars, and added a separate `/api/search/customers` endpoint. GlobalSearch now hits both in parallel — fast groups (pages/stores/styles) render in ~200 ms, customers stream in 0–2 s after.
  - **Total Customers tile** (Customers): headline value = `New + Returning + Walk-ins`, with a 3-way breakdown line beneath. Compare delta uses the combined total across both periods.
  - **Walk-in capture · by store** moved off Locations and onto Customers as a full sortable table (`[data-testid="walk-ins-by-store-card"]`): every store, default sort = Capture % ascending (worst first), pill colors (≥98% green / 95–98% amber / <95% red), CSV export. `LocationsCaptureRatePanel.jsx` deleted.
  - **Inventory · Overall Weeks of Cover KPI** (`[data-testid="inv-kpi-weeks-of-cover"]`): Σ current_stock ÷ (Σ units_sold_28d ÷ 4). Grid widened to 5 columns. Action button scrolls to the per-style WoC table.
  - **IBT row drill-down** (`[data-testid^="ibt-sku-breakdown-"]`): each suggestion row is now expandable. Backend `/api/analytics/ibt-sku-breakdown?style_name&from_store&to_store&units_to_move` returns per-SKU `{sku, color, size, from_available, to_available, suggested_qty}`. Greedy allocation: fill TO=0 SKUs first using FROM-excess, with a 1-unit safety buffer when from_available > 2.
  - `SortableTable` extended with `renderExpanded` + `rowKey` + `footerRow` props.
- **Walk-in capture leaderboard** (Locations page) — initial implementation, since superseded by the Customers-page full table above.
- **Walk-ins KPI** (`/api/customers/walk-ins`): counts anonymous orders per period (detection rule = `customer_type IN ('Guest','Walk-in','Anonymous') OR customer_id IS NULL`), with per-country and per-location breakdowns. Endpoint chunks `/orders` into ≤30-day windows so long ranges don't hit the upstream's 50k row cap.
- **Category × Country Matrix** (`/api/analytics/category-country-matrix`, new `Country Matrix` sub-tab inside Products): rows = subcategories, cols = Kenya / Uganda / Rwanda / Online, cells = `KES X (Y% of {country})` where Y% is the subcategory's share of THAT country's total. Sortable by any column, sticky country-totals footer row, CSV export. Built on a new `footerRow` prop in `SortableTable.jsx`.
- **httpx pool fix**: Bumped shared client to `max_connections=200, max_keepalive_connections=50`, decoupled `pool=15s` from `read=45s` so transient pool saturation falls back to the `_kpi_stale_cache` instead of surfacing "PoolTimeout: timed out after 2 attempts" on the Overview banner.
- **Deployment readiness audit**: Passed via Deployer Agent (no blockers, no warnings).
- **Customers page latency fix**: Split slow upstream `/churned-customers?limit=100000` (≈30 s, frequent 503s) out of `/api/customers` into a dedicated non-blocking `/api/customers/churn-rate` endpoint with a 60 s negative cache. `/api/customers` cold: 38 s → 5.5 s. Churn tile shows "computing…" until ready.
- **Universal upstream response cache** in `fetch()` (TTL 120 s, bounded 2000 entries, cleared via `/api/admin/cache-clear`). Every page after first warm-up loads in <1 s end-to-end:
  - Overview: 1.17 s → **0.19 s**
  - Products: 4.51 s → **0.17 s**
  - Inventory: 15.54 s → **1.01 s**
  - Footfall: 2.01 s → **0.13 s**
  - Customers: 1.47 s → **0.14 s**
- **Deployment loop fix**: `.gitignore` was excluding `.env / .env.* / *.env` (two duplicate blocks at lines 94-96 and 113-115). Removed so Emergent's deployer can pick up the env files for production substitution. Also bounded `/api/admin/users` query to `.limit(1000)`.
- **New global filter bar**: replaced the flat preset+date row on every page with three pill buttons:
  - **Date Range pill** — calendar icon + selected-label + chevron, opens a 640px panel with a left preset sidebar (Today, Yesterday, Last 7/30/90/365 days, Last week/month/quarter/12 months/year, Month-to-date, Quarter-to-date, Year-to-date, Custom) and a right-side dual-month `Calendar` (range mode), date inputs with → arrow, disabled time picker, Cancel + Apply buttons.
  - **Comparison Period pill** — dropdown with `No comparison / Yesterday / Previous year / Previous year (match day of week) / Custom`. Custom reveals two date inputs + apply.
  - **Currency pill** — KES, disabled with tooltip "Multi-currency coming soon — KES locked for now" (cosmetic only per current scope).
  - **Mobile**: all three pills + Country/POS multi-selects collapse into a single "Filters" pill that opens a bottom-sheet.
  - URL params persist `p, d, t, co, ch, cm, cd, ce, cu` (also accepts long names `period, date_from, date_to, country, pos, compare, compare_from, compare_to, currency` for shareable links).
  - Default compareMode changed from `last_month` → `none`.
- **Overview page reorder**: KPI cards / sub-KPIs / charts / location-channel breakdown table now render at the top; an "Insights & Projections" divider separates the below-the-fold section (DailyBriefing → WhatChangedBelt → WinsThisWeekCard → StoreOfTheWeek → SalesProjection → DataFreshness).
- **Channel segmentation toggle (All / Retail / Online)** — segmented control placed right of the Date Range pill, reachable on every page. State persists in URL via `cg` (`channel_group` in shareable links) and survives refreshes / cross-page navigation. Selection drives the `effectiveChannels` derived list which flows through every API call via existing `buildParams(applied)`. **Manual channel multi-select still wins** when populated. Retail = channels NOT matching `/online/i`; Online = channels matching `/online/i`.
- **Active POS list fetch is now auth-gated** — `/analytics/active-pos` is only requested AFTER `useAuth().user` is set, so the Retail toggle no longer shipped an empty channel list because of pre-login 401s.
- **Bar/table chart enhancements** — five Overview charts (Sales by Location [renamed], Country Split, Channel Split, Sales by Category, Sales by Subcategory) now render `KES X (Y%) ▲▼Z%` inline labels via the new `makePctDeltaLabel` helper in `ChartHelpers.jsx`. Green for positive, red for negative, grey dash for ~zero, hidden when compareMode = `none`. Memos extended with `delta_pct` from `salesPrev` / `countrySummaryPrev` / `subcatsPrev`.
- **"Previous month"** restored as a Compare option (between Yesterday and Previous year).
- **Top-row KPI grid** is now 6-tile (Total Sales / Net Sales / Total Orders / Total Units Sold / Total Footfall / Conversion Rate) — the redundant Footfall row that appeared after the sub-KPIs has been removed.

## Roadmap
### P1 — Refactor (in progress)
- Continue extracting from `/app/backend/server.py` (now 5,520 lines after iter_43 pass 1):
  - `routes/customers.py` — `/customers`, `/customers/churn-rate`, `/customers/walk-ins`, `/customer-trend`, `/top-customers`, `/customer-search`, `/customer-products`, `/churned-customers`, `/orders`, `/customer-frequency`, `/customers-by-location`, `/new-customer-products`, `/customer-products`.
  - `routes/footfall.py` — `/footfall`, `/footfall/weekday-pattern`, `/footfall/daily-calendar`.
  - `routes/exports.py` — `/exports/store-kpis`, `/exports/period-performance`, `/exports/stock-rebalancing`.
  - `routes/sor.py` — `/sor`, `/analytics/sor-new-styles-l10`, `/analytics/sor-all-styles`, `/analytics/style-sku-breakdown`, `/analytics/style-sku-breakdown-bulk`, `/analytics/new-styles`, `/analytics/new-styles-curve`.
  - `routes/stock_to_sales.py` — `/stock-to-sales`, `/analytics/stock-to-sales-by-subcat`, `/analytics/stock-to-sales-by-category`, `/analytics/stock-to-sales-by-attribute`, `/analytics/stock-to-sales-by-sku`, `/analytics/weeks-of-cover`, `/analytics/sell-through-by-location`, `/analytics/inventory-summary`, `/analytics/low-stock`.
  - `routes/replenishment.py` — `/analytics/replenishment-report`, `/analytics/replenishment-report/mark`, `/admin/refresh-bins`.
  - `routes/ibt.py` — `/analytics/ibt-suggestions`, `/analytics/ibt-sku-breakdown`.
  - `routes/misc.py` — `/analytics/price-changes`, `/analytics/returns`, `/analytics/insights`, `/analytics/churn`, `/analytics/active-pos`, `/analytics/sales-projection`, `/analytics/customer-crosswalk`, leaderboards.

### P2
- Margin reporting (gross margin at category & product level)
- Proper FX handling via `dim_fx_rate` for UGX / RWF → KES
- Training Dashboard from Google Sheet (BLOCKED — sheet `1K_cGADA67ymxruhcti5YvEY36qm7b1lbFNo65py20e4` requires public access or CSV export)

### P3
- Wire L-10 SOR action choices `{Reorder · Markdown · IBT · Hold}` into `recommendations_state`
- In-memory caches (`_kpi_stale_cache`, `_churn_full_cache`) → migrate to Mongo / Redis if multi-replica deploy is planned (currently single-replica safe)

## Test Credentials
See `/app/memory/test_credentials.md`.
