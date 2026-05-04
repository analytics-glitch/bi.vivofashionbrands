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

## Recently Shipped (2026-04-26 / 27 / 28 / 29 / 30 / 5-1 / 5-4)
## Recently Shipped
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
