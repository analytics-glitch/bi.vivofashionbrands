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

## Recently Shipped (2026-04-26 / 27 / 28)
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
### P1 — Refactor
- Break up `/app/backend/server.py` (>2600 lines) into routers: `routers/sales.py`, `routers/inventory.py`, `routers/analytics.py`, `routers/customers.py`.

### P2
- Margin reporting (gross margin at category & product level)
- Proper FX handling via `dim_fx_rate` for UGX / RWF → KES

### P3
- Wire L-10 SOR action choices `{Reorder · Markdown · IBT · Hold}` into `recommendations_state`
- In-memory caches (`_kpi_stale_cache`, `_churn_full_cache`) → migrate to Mongo / Redis if multi-replica deploy is planned (currently single-replica safe)

## Test Credentials
See `/app/memory/test_credentials.md`.
